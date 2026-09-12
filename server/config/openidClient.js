const openidClient = require("openid-client");

const OIDC_HTTP_TIMEOUT_MS = 10000;

openidClient.custom.setHttpOptionsDefaults({
  timeout: OIDC_HTTP_TIMEOUT_MS,
});

console.log(`OIDC HTTP timeout configured: ${OIDC_HTTP_TIMEOUT_MS}ms`);

module.exports = openidClient;
