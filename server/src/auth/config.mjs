import { createRemoteTokenVerifier } from './remote-token-verifier.mjs';

export function configuredAuthenticator(environment = process.env) {
  const endpoint = environment.MOSHROIDS_AUTH_VERIFY_URL;
  if (!endpoint) throw new Error('MOSHROIDS_AUTH_VERIFY_URL is required for classroom authentication.');
  return createRemoteTokenVerifier({ endpoint, audience: 'moshroids' });
}
