import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'node_modules/**/*',
      'android_admin_app/**/*',
      'desktop_app/**/*',
      'electron/**/*',
      'scripts/**/*',
      'src/**/*',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
