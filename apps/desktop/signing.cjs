// Which code-signing steps this build can take, decided only from the environment. CommonJS so
// electron-builder.config.cjs can load it.
//
// Nothing here ever reads, stores or logs a credential value: it only checks that the variables
// electron-builder itself consumes are present. Without them the build is explicitly UNSIGNED, the
// same as before signing support existed.
//
//   Windows   WIN_CSC_LINK (or CSC_LINK) + WIN_CSC_KEY_PASSWORD (or CSC_KEY_PASSWORD): a code-signing .pfx/.p12
//   macOS     CSC_LINK + CSC_KEY_PASSWORD: a "Developer ID Application" .p12
//   macOS     notarization, either APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//             or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
//   Linux     AppImages are not signed.

const has = (env, ...names) => names.every((n) => typeof env[n] === 'string' && env[n].trim() !== '');

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ windows: boolean, mac: boolean, notarize: boolean }}
 */
function signingPlan(env = process.env) {
  const windows =
    (has(env, 'WIN_CSC_LINK') || has(env, 'CSC_LINK')) && (has(env, 'WIN_CSC_KEY_PASSWORD') || has(env, 'CSC_KEY_PASSWORD'));
  const mac = has(env, 'CSC_LINK', 'CSC_KEY_PASSWORD');
  const notarize =
    mac && (has(env, 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID') || has(env, 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'));
  return { windows, mac, notarize };
}

module.exports = { signingPlan };
