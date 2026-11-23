package com.paaswiver.admin

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private enum class SectionTab {
        TRIAL, ACTIVE, EXPIRED, ALL
    }

    private val client = FirebaseRestClient()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val allUsers = ArrayList<UserLicense>()
    private val visibleUsers = ArrayList<UserLicense>()

    private var activeTab = SectionTab.TRIAL

    private lateinit var rootContainer: LinearLayout
    private lateinit var adapter: ArrayAdapter<UserLicense>
    private var statusTextView: TextView? = null
    private var countTextView: TextView? = null
    private var tabTrialBtn: Button? = null
    private var tabActiveBtn: Button? = null
    private var tabExpiredBtn: Button? = null
    private var tabAllBtn: Button? = null
    private var isForeground = false

    private val ticker = object : Runnable {
        override fun run() {
            if (isForeground && client.isSignedIn()) {
                applyFilterAndRefreshCounts(updateList = true)
                mainHandler.postDelayed(this, 1000L)
            }
        }
    }

    private val autoRefreshTask = object : Runnable {
        override fun run() {
            if (isForeground && client.isSignedIn()) {
                refreshUsers(silent = true)
                mainHandler.postDelayed(this, 12000L)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        rootContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0F17"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(rootContainer)
        showLoginView()
    }

    override fun onResume() {
        super.onResume()
        isForeground = true
        if (client.isSignedIn()) {
            mainHandler.post(ticker)
            mainHandler.postDelayed(autoRefreshTask, 12000L)
        }
    }

    override fun onPause() {
        super.onPause()
        isForeground = false
        mainHandler.removeCallbacks(ticker)
        mainHandler.removeCallbacks(autoRefreshTask)
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun makeCardBg(fillHex: String, strokeHex: String, radiusDp: Int = 8): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(fillHex))
            setStroke(dp(1), Color.parseColor(strokeHex))
            cornerRadius = dp(radiusDp).toFloat()
        }
    }

    private fun showLoginView() {
        mainHandler.removeCallbacks(ticker)
        mainHandler.removeCallbacks(autoRefreshTask)
        rootContainer.removeAllViews()

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = makeCardBg("#111827", "#1F2937", 10)
            setPadding(dp(20), dp(22), dp(20), dp(22))
        }

        val title = TextView(this).apply {
            text = "PAAS WIVER Admin"
            textSize = 20f
            setTypeface(Typeface.DEFAULT_BOLD)
            setTextColor(Color.WHITE)
        }
        val subtitle = TextView(this).apply {
            text = "Sign in with admin email & password to manage Trial users, Active licenses, extend expiry dates, or delete accounts."
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(6), 0, dp(14))
        }

        val emailInput = EditText(this).apply {
            hint = "Admin email (${FirebaseConfig.ADMIN_EMAIL_HINT})"
            setText(FirebaseConfig.ADMIN_EMAIL_HINT)
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#64748B"))
            background = makeCardBg("#080C13", "#334155", 6)
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }

        val passInput = EditText(this).apply {
            hint = "Admin password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#64748B"))
            background = makeCardBg("#080C13", "#334155", 6)
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }

        val errLabel = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor("#FDA4AF"))
            visibility = View.GONE
            setPadding(0, dp(8), 0, 0)
        }

        val loginBtn = Button(this).apply {
            text = "SIGN IN AS ADMIN"
            setTextColor(Color.WHITE)
            background = makeCardBg("#0891B2", "#06B6D4", 6)
            setTypeface(Typeface.DEFAULT_BOLD)
        }

        loginBtn.setOnClickListener {
            val email = emailInput.text.toString().trim()
            val pass = passInput.text.toString()
            if (email.isEmpty() || pass.length < 6) {
                errLabel.text = "Enter valid admin email and password (min 6 chars)."
                errLabel.visibility = View.VISIBLE
                return@setOnClickListener
            }
            loginBtn.isEnabled = false
            loginBtn.text = "SIGNING IN..."
            errLabel.visibility = View.GONE

            thread {
                try {
                    client.signInAdmin(email, pass)
                    mainHandler.post {
                        showDashboardView()
                    }
                } catch (ex: Exception) {
                    mainHandler.post {
                        loginBtn.isEnabled = true
                        loginBtn.text = "SIGN IN AS ADMIN"
                        errLabel.text = ex.message ?: "Login failed"
                        errLabel.visibility = View.VISIBLE
                    }
                }
            }
        }

        card.addView(title)
        card.addView(subtitle)
        card.addView(emailInput, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(10) })
        card.addView(passInput, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })
        card.addView(loginBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        card.addView(errLabel)

        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(24), dp(20), dp(24))
            addView(card, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ))
        }
        rootContainer.addView(wrapper, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
    }

    private fun showDashboardView() {
        rootContainer.removeAllViews()

        // Top Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#111827"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }

        val headerTitle = TextView(this).apply {
            text = "PAAS WIVER Admin"
            textSize = 16f
            setTypeface(Typeface.DEFAULT_BOLD)
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val addUserBtn = Button(this).apply {
            text = "+ ADD USER"
            textSize = 11f
            setTextColor(Color.WHITE)
            background = makeCardBg("#0891B2", "#06B6D4", 6)
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }

        val refreshBtn = Button(this).apply {
            text = "SYNC"
            textSize = 11f
            setTextColor(Color.parseColor("#E2E8F0"))
            background = makeCardBg("#1E293B", "#334155", 6)
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }

        val signOutBtn = Button(this).apply {
            text = "EXIT"
            textSize = 11f
            setTextColor(Color.parseColor("#FDA4AF"))
            background = makeCardBg("#1E293B", "#7F1D1D", 6)
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }

        header.addView(headerTitle)
        header.addView(addUserBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)
        ).apply { marginEnd = dp(6) })
        header.addView(refreshBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)
        ).apply { marginEnd = dp(6) })
        header.addView(signOutBtn, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)
        ))

        // Section Tabs: TRIAL | ACTIVE | EXPIRED | ALL
        val tabBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0D131F"))
            setPadding(dp(10), dp(8), dp(10), dp(6))
        }

        fun makeTabBtn(label: String): Button {
            return Button(this).apply {
                text = label
                textSize = 11f
                typeface = Typeface.MONOSPACE
                setPadding(dp(4), dp(4), dp(4), dp(4))
                layoutParams = LinearLayout.LayoutParams(0, dp(34), 1f).apply {
                    marginStart = dp(3)
                    marginEnd = dp(3)
                }
            }
        }

        tabTrialBtn = makeTabBtn("TRIAL (0)")
        tabActiveBtn = makeTabBtn("ACTIVE (0)")
        tabExpiredBtn = makeTabBtn("EXPIRED (0)")
        tabAllBtn = makeTabBtn("ALL (0)")

        tabTrialBtn?.setOnClickListener { switchTab(SectionTab.TRIAL) }
        tabActiveBtn?.setOnClickListener { switchTab(SectionTab.ACTIVE) }
        tabExpiredBtn?.setOnClickListener { switchTab(SectionTab.EXPIRED) }
        tabAllBtn?.setOnClickListener { switchTab(SectionTab.ALL) }

        tabBar.addView(tabTrialBtn)
        tabBar.addView(tabActiveBtn)
        tabBar.addView(tabExpiredBtn)
        tabBar.addView(tabAllBtn)

        // Info Sub-bar
        val subBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0B0F17"))
            setPadding(dp(14), dp(6), dp(14), dp(6))
        }

        countTextView = TextView(this).apply {
            text = "Showing: 0"
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#22D3EE"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        statusTextView = TextView(this).apply {
            text = "Tap user to extend date or delete"
            textSize = 11f
            setTextColor(Color.parseColor("#94A3B8"))
        }

        subBar.addView(countTextView)
        subBar.addView(statusTextView)

        val listView = ListView(this).apply {
            divider = null
            dividerHeight = dp(8)
            setPadding(dp(12), dp(8), dp(12), dp(12))
            clipToPadding = false
        }

        adapter = object : ArrayAdapter<UserLicense>(this, 0, visibleUsers) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val item = getItem(position)!!
                val now = System.currentTimeMillis()
                val expired = item.expiresAtMs <= now

                val card = (convertView as? LinearLayout) ?: LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), dp(12), dp(14), dp(12))
                }
                card.removeAllViews()
                card.background = makeCardBg(
                    "#111827",
                    when {
                        expired -> "#7F1D1D"
                        item.status == "trial" -> "#92400E"
                        else -> "#1E293B"
                    },
                    8
                )

                val topRow = LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }
                val nameTv = TextView(context).apply {
                    text = item.username
                    textSize = 15f
                    typeface = Typeface.MONOSPACE
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
                val stateTv = TextView(context).apply {
                    text = when {
                        item.status == "trial" && expired -> "TRIAL EXPIRED"
                        item.status == "trial" -> "10m TRIAL"
                        expired -> "EXPIRED"
                        else -> "ACTIVE"
                    }
                    textSize = 11f
                    typeface = Typeface.MONOSPACE
                    setTextColor(
                        Color.parseColor(
                            when {
                                expired -> "#FB7185"
                                item.status == "trial" -> "#FCD34D"
                                else -> "#34D399"
                            }
                        )
                    )
                }
                topRow.addView(nameTv)
                topRow.addView(stateTv)

                val remTv = TextView(context).apply {
                    text = "Time left: ${formatRemaining(item.expiresAtMs, now)}"
                    textSize = 13f
                    typeface = Typeface.MONOSPACE
                    setTextColor(Color.parseColor(if (expired) "#FDA4AF" else "#22D3EE"))
                    setPadding(0, dp(4), 0, dp(2))
                }

                val expDateTv = TextView(context).apply {
                    val fmt = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault())
                    text = "Target Expiry: ${fmt.format(Date(item.expiresAtMs))}"
                    textSize = 11f
                    typeface = Typeface.MONOSPACE
                    setTextColor(Color.parseColor("#94A3B8"))
                }

                card.addView(topRow)
                card.addView(remTv)
                card.addView(expDateTv)
                return card
            }
        }
        listView.adapter = adapter

        listView.setOnItemClickListener { _, _, position, _ ->
            val selected = visibleUsers.getOrNull(position) ?: return@setOnItemClickListener
            showUserActionsDialog(selected)
        }

        addUserBtn.setOnClickListener { showCreateUserDialog() }
        refreshBtn.setOnClickListener { refreshUsers(silent = false) }
        signOutBtn.setOnClickListener {
            client.signOut()
            showLoginView()
        }

        rootContainer.addView(header)
        rootContainer.addView(tabBar)
        rootContainer.addView(subBar)
        rootContainer.addView(listView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        styleTabButtons()
        refreshUsers(silent = false)
        mainHandler.post(ticker)
        mainHandler.postDelayed(autoRefreshTask, 12000L)
    }

    private fun switchTab(tab: SectionTab) {
        activeTab = tab
        styleTabButtons()
        applyFilterAndRefreshCounts(updateList = true)
    }

    private fun styleTabButtons() {
        val pairs = listOf(
            tabTrialBtn to SectionTab.TRIAL,
            tabActiveBtn to SectionTab.ACTIVE,
            tabExpiredBtn to SectionTab.EXPIRED,
            tabAllBtn to SectionTab.ALL
        )
        for ((btn, tab) in pairs) {
            val selected = activeTab == tab
            btn?.setTextColor(Color.parseColor(if (selected) "#FFFFFF" else "#94A3B8"))
            btn?.background = makeCardBg(
                if (selected) "#0891B2" else "#111827",
                if (selected) "#22D3EE" else "#1E293B",
                6
            )
        }
    }

    private fun applyFilterAndRefreshCounts(updateList: Boolean) {
        val now = System.currentTimeMillis()
        var trialCount = 0
        var activeCount = 0
        var expiredCount = 0

        for (u in allUsers) {
            if (u.status == "trial") trialCount++
            if (u.status != "trial" && u.expiresAtMs > now) activeCount++
            if (u.expiresAtMs <= now) expiredCount++
        }

        tabTrialBtn?.text = "TRIAL ($trialCount)"
        tabActiveBtn?.text = "ACTIVE ($activeCount)"
        tabExpiredBtn?.text = "EXPIRED ($expiredCount)"
        tabAllBtn?.text = "ALL (${allUsers.size})"

        if (updateList) {
            visibleUsers.clear()
            for (u in allUsers) {
                val match = when (activeTab) {
                    SectionTab.TRIAL -> u.status == "trial"
                    SectionTab.ACTIVE -> u.status != "trial" && u.expiresAtMs > now
                    SectionTab.EXPIRED -> u.expiresAtMs <= now
                    SectionTab.ALL -> true
                }
                if (match) visibleUsers.add(u)
            }
            countTextView?.text = "${activeTab.name}: ${visibleUsers.size} users"
            adapter.notifyDataSetChanged()
        }
    }

    private fun refreshUsers(silent: Boolean) {
        if (!silent) {
            statusTextView?.text = "Syncing..."
        }
        thread {
            try {
                val list = client.listLicenses()
                mainHandler.post {
                    allUsers.clear()
                    allUsers.addAll(list)
                    applyFilterAndRefreshCounts(updateList = true)
                    statusTextView?.text = "Tap user to extend date or delete"
                }
            } catch (ex: Exception) {
                mainHandler.post {
                    statusTextView?.text = "Sync failed"
                    if (!silent) {
                        Toast.makeText(this, ex.message ?: "Failed to load users", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun showCreateUserDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(12), dp(18), dp(8))
        }

        val userInput = EditText(this).apply {
            hint = "Username (e.g. operator_01)"
        }
        val passInput = EditText(this).apply {
            hint = "Password (min 6 chars)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val durations = arrayOf(
            "10 Minutes (Trial)",
            "1 Hour",
            "1 Day",
            "7 Days",
            "30 Days",
            "1 Year"
        )
        val durationMs = longArrayOf(
            10L * 60 * 1000,
            60L * 60 * 1000,
            24L * 60 * 60 * 1000,
            7L * 24 * 60 * 60 * 1000,
            30L * 24 * 60 * 60 * 1000,
            365L * 24 * 60 * 60 * 1000
        )
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, durations)
        }

        layout.addView(userInput)
        layout.addView(passInput)
        layout.addView(spinner)

        AlertDialog.Builder(this)
            .setTitle("Create User & License")
            .setView(layout)
            .setPositiveButton("Create") { _, _ ->
                val u = userInput.text.toString()
                val p = passInput.text.toString()
                val idx = spinner.selectedItemPosition.coerceIn(0, durationMs.lastIndex)
                val targetMs = System.currentTimeMillis() + durationMs[idx]
                val isTrial = idx == 0
                statusTextView?.text = "Creating user..."
                thread {
                    try {
                        client.createUserWithLicense(u, p, targetMs, isTrial)
                        mainHandler.post {
                            Toast.makeText(this, "User created!", Toast.LENGTH_SHORT).show()
                            refreshUsers(silent = false)
                        }
                    } catch (ex: Exception) {
                        mainHandler.post {
                            statusTextView?.text = "Create failed"
                            Toast.makeText(this, ex.message ?: "Create error", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showUserActionsDialog(user: UserLicense) {
        val options = arrayOf(
            "Extend +10 Minutes (Activate)",
            "Extend +1 Hour (Activate)",
            "Extend +1 Day (Activate)",
            "Extend +7 Days (Activate)",
            "Extend +30 Days (Activate)",
            "Pick Custom Expiry Date & Time",
            "Delete User"
        )

        AlertDialog.Builder(this)
            .setTitle("${user.username} (${formatRemaining(user.expiresAtMs, System.currentTimeMillis())})")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> extendUserBy(user, 10L * 60 * 1000)
                    1 -> extendUserBy(user, 60L * 60 * 1000)
                    2 -> extendUserBy(user, 24L * 60 * 60 * 1000)
                    3 -> extendUserBy(user, 7L * 24 * 60 * 60 * 1000)
                    4 -> extendUserBy(user, 30L * 24 * 60 * 60 * 1000)
                    5 -> pickCustomDateTime(user)
                    6 -> confirmDeleteUser(user)
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun extendUserBy(user: UserLicense, addMs: Long) {
        val base = maxOf(System.currentTimeMillis(), user.expiresAtMs)
        val targetMs = base + addMs
        statusTextView?.text = "Updating ${user.username}..."
        thread {
            try {
                client.updateExpiry(user.uid, targetMs)
                mainHandler.post {
                    Toast.makeText(this, "Date extended & user activated!", Toast.LENGTH_SHORT).show()
                    refreshUsers(silent = false)
                }
            } catch (ex: Exception) {
                mainHandler.post {
                    Toast.makeText(this, ex.message ?: "Update failed", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun pickCustomDateTime(user: UserLicense) {
        val cal = Calendar.getInstance().apply {
            timeInMillis = maxOf(System.currentTimeMillis(), user.expiresAtMs)
        }
        DatePickerDialog(
            this,
            { _, year, month, day ->
                TimePickerDialog(
                    this,
                    { _, hour, minute ->
                        val chosen = Calendar.getInstance().apply {
                            set(year, month, day, hour, minute, 0)
                            set(Calendar.MILLISECOND, 0)
                        }
                        val targetMs = chosen.timeInMillis
                        statusTextView?.text = "Saving custom date..."
                        thread {
                            try {
                                client.updateExpiry(user.uid, targetMs)
                                mainHandler.post {
                                    Toast.makeText(this, "Expiry date updated!", Toast.LENGTH_SHORT).show()
                                    refreshUsers(silent = false)
                                }
                            } catch (ex: Exception) {
                                mainHandler.post {
                                    Toast.makeText(this, ex.message ?: "Update failed", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    },
                    cal.get(Calendar.HOUR_OF_DAY),
                    cal.get(Calendar.MINUTE),
                    false
                ).show()
            },
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH),
            cal.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun confirmDeleteUser(user: UserLicense) {
        AlertDialog.Builder(this)
            .setTitle("Delete ${user.username}?")
            .setMessage("This immediately revokes their PAAS WIVER license.")
            .setPositiveButton("Delete") { _, _ ->
                statusTextView?.text = "Deleting ${user.username}..."
                thread {
                    try {
                        client.deleteLicense(user.uid)
                        mainHandler.post {
                            Toast.makeText(this, "Deleted ${user.username}", Toast.LENGTH_SHORT).show()
                            refreshUsers(silent = false)
                        }
                    } catch (ex: Exception) {
                        mainHandler.post {
                            Toast.makeText(this, ex.message ?: "Delete failed", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun formatRemaining(expiresAtMs: Long, nowMs: Long): String {
        val diff = expiresAtMs - nowMs
        if (diff <= 0L) {
            val agoMin = kotlin.math.abs(diff) / 60000L
            if (agoMin < 60L) return "Expired ${agoMin}m ago"
            val agoHr = agoMin / 60L
            if (agoHr < 24L) return "Expired ${agoHr}h ago"
            return "Expired ${agoHr / 24L}d ago"
        }
        val totalSec = diff / 1000L
        val days = totalSec / 86400L
        val hours = (totalSec % 86400L) / 3600L
        val mins = (totalSec % 3600L) / 60L
        val secs = totalSec % 60L
        if (days > 0L) return "${days}d ${hours}h ${mins}m left"
        if (hours > 0L) return "${hours}h ${mins}m ${secs}s left"
        return String.format(Locale.US, "%02dm %02ds left", mins, secs)
    }
}
