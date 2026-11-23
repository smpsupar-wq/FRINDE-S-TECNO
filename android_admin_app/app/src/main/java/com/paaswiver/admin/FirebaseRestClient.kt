package com.paaswiver.admin

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class UserLicense(
    val uid: String,
    val ownerUid: String,
    val username: String,
    val role: String,
    val status: String,
    val trialGranted: Boolean,
    val expiresAtMs: Long,
    val createdAtMs: Long,
    val updatedAtMs: Long
)

data class AdminSession(
    var idToken: String,
    var refreshToken: String,
    var uid: String,
    var email: String,
    var expiresAtMs: Long
)

class FirebaseRestClient {
    private var session: AdminSession? = null

    fun currentEmail(): String? = session?.email

    fun signOut() {
        session = null
    }

    fun isSignedIn(): Boolean = session != null

    fun sanitizeUsername(raw: String): String {
        return raw.trim().lowercase(Locale.US).replace(Regex("[^a-z0-9_.-]"), "")
    }

    fun usernameToEmail(username: String): String {
        return "${sanitizeUsername(username)}@paaswiver.local"
    }

    fun signInAdmin(email: String, password: String): AdminSession {
        val url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FirebaseConfig.API_KEY}"
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .put("returnSecureToken", true)
        val res = postJson(url, body, null)
        val expiresInSec = res.optString("expiresIn", "3600").toLongOrNull() ?: 3600L
        val newSession = AdminSession(
            idToken = res.getString("idToken"),
            refreshToken = res.getString("refreshToken"),
            uid = res.getString("localId"),
            email = res.optString("email", email.trim()),
            expiresAtMs = System.currentTimeMillis() + expiresInSec * 1000L
        )

        // Check emailVerified via accounts:lookup so Firestore isVerifiedBootstrapAdmin() passes
        val lookupUrl = "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FirebaseConfig.API_KEY}"
        val lookupRes = postJson(lookupUrl, JSONObject().put("idToken", newSession.idToken), null)
        val usersArr = lookupRes.optJSONArray("users")
        val verified = if (usersArr != null && usersArr.length() > 0) {
            usersArr.getJSONObject(0).optBoolean("emailVerified", false)
        } else {
            false
        }
        if (!verified) {
            // Send 1-time verification email automatically so admin can click the link in Gmail
            runCatching {
                val verifyUrl = "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FirebaseConfig.API_KEY}"
                postJson(
                    verifyUrl,
                    JSONObject().put("requestType", "VERIFY_EMAIL").put("idToken", newSession.idToken),
                    null
                )
            }
            throw IllegalStateException(
                "Verification email sent to ${newSession.email}. Open Gmail, click the verification link once, then Sign In again."
            )
        }

        session = newSession
        return newSession
    }

    private fun ensureFreshToken(): String {
        val current = session ?: throw IllegalStateException("Not signed in")
        if (System.currentTimeMillis() < current.expiresAtMs - 60_000L) {
            return current.idToken
        }
        val url = "https://securetoken.googleapis.com/v1/token?key=${FirebaseConfig.API_KEY}"
        val payload = "grant_type=refresh_token&refresh_token=${URLEncoder.encode(current.refreshToken, "UTF-8")}"
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            connectTimeout = 15000
            readTimeout = 15000
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(payload) }
        val text = readResponse(conn)
        val json = JSONObject(text)
        val expiresInSec = json.optString("expires_in", "3600").toLongOrNull() ?: 3600L
        current.idToken = json.getString("id_token")
        current.refreshToken = json.getString("refresh_token")
        current.expiresAtMs = System.currentTimeMillis() + expiresInSec * 1000L
        return current.idToken
    }

    private fun dbRoot(): String {
        return "https://firestore.googleapis.com/v1/projects/${FirebaseConfig.PROJECT_ID}/databases/${FirebaseConfig.DATABASE_ID}/documents"
    }

    private fun commitUrl(): String {
        return "${dbRoot()}:commit"
    }

    private fun docName(uid: String): String {
        return "projects/${FirebaseConfig.PROJECT_ID}/databases/${FirebaseConfig.DATABASE_ID}/documents/licenses/$uid"
    }

    fun listLicenses(): List<UserLicense> {
        val token = ensureFreshToken()
        val url = "${dbRoot()}/licenses?pageSize=300"
        val res = getJson(url, token)
        val docs = res.optJSONArray("documents") ?: return emptyList()
        val list = ArrayList<UserLicense>(docs.length())
        for (i in 0 until docs.length()) {
            val docObj = docs.getJSONObject(i)
            val fullName = docObj.getString("name")
            val docId = fullName.substringAfterLast('/')
            val fields = docObj.optJSONObject("fields") ?: continue
            list.add(
                UserLicense(
                    uid = readStr(fields, "uid", docId),
                    ownerUid = readStr(fields, "ownerUid", docId),
                    username = readStr(fields, "username", docId),
                    role = readStr(fields, "role", "user"),
                    status = readStr(fields, "status", "trial"),
                    trialGranted = fields.optJSONObject("trialGranted")?.optBoolean("booleanValue", true) ?: true,
                    expiresAtMs = readTsMillis(fields, "expiresAt"),
                    createdAtMs = readTsMillis(fields, "createdAt"),
                    updatedAtMs = readTsMillis(fields, "updatedAt")
                )
            )
        }
        return list.sortedByDescending { it.createdAtMs }
    }

    fun createUserWithLicense(usernameRaw: String, password: String, expiresAtMs: Long, isTrial: Boolean) {
        val clean = sanitizeUsername(usernameRaw)
        require(clean.length in 2..40) { "Username must be 2-40 characters (letters, numbers, _ . -)" }
        require(password.length >= 6) { "Password must be at least 6 characters" }

        val token = ensureFreshToken()
        // 1. Provision Firebase Auth user without touching admin session
        val signUpUrl = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FirebaseConfig.API_KEY}"
        val signUpBody = JSONObject()
            .put("email", usernameToEmail(clean))
            .put("password", password)
            .put("returnSecureToken", true)
        val authRes = postJson(signUpUrl, signUpBody, null)
        val newUid = authRes.getString("localId")

        // 2. Commit /licenses/{uid} with server REQUEST_TIME for createdAt & updatedAt (required by firestore.rules)
        val fields = JSONObject()
            .put("uid", JSONObject().put("stringValue", newUid))
            .put("ownerUid", JSONObject().put("stringValue", newUid))
            .put("username", JSONObject().put("stringValue", clean))
            .put("role", JSONObject().put("stringValue", "user"))
            .put("status", JSONObject().put("stringValue", if (isTrial) "trial" else "active"))
            .put("trialGranted", JSONObject().put("booleanValue", true))
            .put("expiresAt", JSONObject().put("timestampValue", formatIsoUtc(expiresAtMs)))

        val transforms = JSONArray()
            .put(JSONObject().put("fieldPath", "createdAt").put("setToServerValue", "REQUEST_TIME"))
            .put(JSONObject().put("fieldPath", "updatedAt").put("setToServerValue", "REQUEST_TIME"))

        val writeObj = JSONObject()
            .put(
                "update",
                JSONObject()
                    .put("name", docName(newUid))
                    .put("fields", fields)
            )
            .put("updateTransforms", transforms)

        val commitBody = JSONObject().put("writes", JSONArray().put(writeObj))
        postJson(commitUrl(), commitBody, token)
    }

    fun updateExpiry(uid: String, newExpiresAtMs: Long) {
        val token = ensureFreshToken()
        val newStatus = if (newExpiresAtMs > System.currentTimeMillis()) "active" else "expired"
        val fields = JSONObject()
            .put("expiresAt", JSONObject().put("timestampValue", formatIsoUtc(newExpiresAtMs)))
            .put("status", JSONObject().put("stringValue", newStatus))

        val transforms = JSONArray()
            .put(JSONObject().put("fieldPath", "updatedAt").put("setToServerValue", "REQUEST_TIME"))

        val mask = JSONObject().put("fieldPaths", JSONArray().put("expiresAt").put("status"))

        val writeObj = JSONObject()
            .put(
                "update",
                JSONObject()
                    .put("name", docName(uid))
                    .put("fields", fields)
            )
            .put("updateMask", mask)
            .put("updateTransforms", transforms)

        val commitBody = JSONObject().put("writes", JSONArray().put(writeObj))
        postJson(commitUrl(), commitBody, token)
    }

    fun deleteLicense(uid: String) {
        val token = ensureFreshToken()
        val url = "${dbRoot()}/licenses/$uid"
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "DELETE"
            setRequestProperty("Authorization", "Bearer $token")
            connectTimeout = 15000
            readTimeout = 15000
        }
        readResponse(conn)
    }

    private fun readStr(fields: JSONObject, key: String, fallback: String): String {
        return fields.optJSONObject(key)?.optString("stringValue", fallback) ?: fallback
    }

    private fun readTsMillis(fields: JSONObject, key: String): Long {
        val raw = fields.optJSONObject(key)?.optString("timestampValue", "") ?: ""
        return parseIsoUtcMillis(raw)
    }

    private fun formatIsoUtc(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(ms))
    }

    private fun parseIsoUtcMillis(raw: String): Long {
        if (raw.isBlank()) return 0L
        return try {
            val cleaned = raw.trim().removeSuffix("Z")
            val dotIdx = cleaned.indexOf('.')
            val normalized = if (dotIdx >= 0) {
                val head = cleaned.substring(0, dotIdx)
                val frac = cleaned.substring(dotIdx + 1).padEnd(3, '0').substring(0, 3)
                "${head}.${frac}Z"
            } else {
                "${cleaned}.000Z"
            }
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            sdf.parse(normalized)?.time ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    private fun getJson(url: String, bearerToken: String): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Authorization", "Bearer $bearerToken")
            connectTimeout = 15000
            readTimeout = 15000
        }
        return JSONObject(readResponse(conn))
    }

    private fun postJson(url: String, body: JSONObject, bearerToken: String?): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            if (bearerToken != null) {
                setRequestProperty("Authorization", "Bearer $bearerToken")
            }
            connectTimeout = 15000
            readTimeout = 15000
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
            it.write(body.toString())
        }
        return JSONObject(readResponse(conn))
    }

    private fun readResponse(conn: HttpURLConnection): String {
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = if (stream != null) {
            BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        } else {
            ""
        }
        if (code !in 200..299) {
            val message = extractErrorMessage(text, code)
            throw RuntimeException(message)
        }
        return if (text.isBlank()) "{}" else text
    }

    private fun extractErrorMessage(body: String, httpCode: Int): String {
        return try {
            val obj = JSONObject(body)
            val msg = obj.optJSONObject("error")?.optString("message")
            when {
                msg.isNullOrBlank() -> "HTTP $httpCode error"
                msg == "OPERATION_NOT_ALLOWED" -> "Enable Email/Password in Firebase Console -> Authentication -> Sign-in method."
                msg == "EMAIL_EXISTS" -> "Username already exists."
                msg == "INVALID_LOGIN_CREDENTIALS" || msg == "INVALID_PASSWORD" || msg == "EMAIL_NOT_FOUND" ->
                    "Invalid admin email or password."
                msg.contains("Missing or insufficient permissions", ignoreCase = true) ->
                    "Admin permission denied. Ensure you signed in with verified ${FirebaseConfig.ADMIN_EMAIL_HINT}."
                else -> msg
            }
        } catch (_: Exception) {
            "HTTP $httpCode: ${body.take(180)}"
        }
    }
}
