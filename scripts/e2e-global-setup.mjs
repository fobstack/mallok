import { assertReusableE2eRun } from './e2e-server.mjs';

/** Refuses MALLOK_E2E_REUSE unless port 8788 belongs to this live wrapper. */
export default async function verifyReusableE2eRun() {
  if (process.env.MALLOK_E2E_REUSE === '1') {
    await assertReusableE2eRun();
  }
}
