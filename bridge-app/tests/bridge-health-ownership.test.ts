import assert from "node:assert/strict";
import test from "node:test";
import { effectiveBridgeHealth } from "../../src/lib/bridge/effective-health";
import type { LocalBridgeHealth } from "../../src/lib/bridge/local-bridge-client";

const localPaired: LocalBridgeHealth = {
  message: "A local Bridge has credentials", ok: true, paired: true,
  platform: "darwin", status: "BRIDGE_READY", version: "0.1-test",
};

test("LOCAL-1 paired credentials from another account never imply this account is ready", () => {
  const result = effectiveBridgeHealth(localPaired, []);
  assert.equal(result.ok, false);
  assert.equal(result.paired, false);
  assert.equal(result.status, "BRIDGE_UNAVAILABLE");
});

test("LOCAL-1 authorized device heartbeat, not unrelated loopback health, establishes cloud readiness", () => {
  const authorized = [{
    bridgeDeviceId: "this-account-device", status: "ONLINE",
    lastSeenAt: "2026-10-20T06:00:00.000Z",
    deviceDisplayName: "Authorized Mac", appVersion: "0.1-test", platform: "MACOS",
  }] as unknown as Parameters<typeof effectiveBridgeHealth>[1];
  const at = new Date("2026-10-20T06:00:30.000Z");
  const result = effectiveBridgeHealth(localPaired, authorized, at);
  assert.equal(result.ok, true);
  assert.equal(result.message.includes("Authorized Mac"), true);
  const stale = effectiveBridgeHealth(localPaired, authorized, new Date("2026-10-20T06:03:00.000Z"));
  assert.equal(stale.ok, false, "A credentialed but unrelated local Bridge cannot cover a stale cloud heartbeat.");
});
