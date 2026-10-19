import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { scanBridgeRoot } from "../src/filesystem/scanner";
import { readBridgeRootFile } from "../src/filesystem/reader";
import {
  executeBridgePlanActions,
  executeBridgeUndoActions,
  inspectUndoFolderName,
  previewBridgeExecution,
  previewBridgeUndo,
} from "../src/filesystem/operations";
import { recoverPhysicalAction } from "../src/filesystem/physical-journal";
import { BridgeAppError, type BridgeExecutionPlanAction, type BridgeUndoPlanAction } from "../src/types";
import { createFolderSelection, registerRootFromSelection } from "../src/main/registry";
import { withBoundedTemporaryRead } from "../../apps/bridge/src/main/command-runner";
import { suppressBroadCategoryMove } from "../../src/lib/bridge/organization-suggestions";
import { reconcileRecommendationDrafts, type RecommendationDraft } from "../../src/lib/bridge/recommendation-reconciliation";

// All paths are disposable and outside iCloud/Documents. No private source,
// pairing credentials, database, network service or paid AI is used.
async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(os.tmpdir(), "nsn-mac-native-acceptance-"));
  const previousData = process.env.NSN_BRIDGE_DATA_DIR;
  const previousFileSecrets = process.env.NSN_BRIDGE_FORCE_FILE_SECRETS_FOR_TESTS;
  process.env.NSN_BRIDGE_DATA_DIR = path.join(base, "isolated-bridge-state");
  process.env.NSN_BRIDGE_FORCE_FILE_SECRETS_FOR_TESTS = "1";
  t.after(async () => {
    if (previousData === undefined) delete process.env.NSN_BRIDGE_DATA_DIR;
    else process.env.NSN_BRIDGE_DATA_DIR = previousData;
    if (previousFileSecrets === undefined) delete process.env.NSN_BRIDGE_FORCE_FILE_SECRETS_FOR_TESTS;
    else process.env.NSN_BRIDGE_FORCE_FILE_SECRETS_FOR_TESTS = previousFileSecrets;
    await rm(base, { force: true, recursive: true });
  });
  const folder = path.join(base, "synthetic-library");
  await mkdir(folder);
  const selection = await createFolderSelection(folder);
  const root = await registerRootFromSelection({
    selectionToken: selection.selectionToken,
    permissions: {
      readPermission: true,
      watchPermission: false,
      recommendationPermission: true,
      organizationPlanPermission: true,
      createFolderPermission: true,
      moveFilePermission: true,
      renameFilePermission: true,
    },
  });
  return { base, folder, rootId: root.id, revision: root.connectionRevision ?? 0 };
}

test("#6 a corrupt seven-byte UTF-8 file fails promptly and never blocks the next valid native read", async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from([0x48, 0x65, 0xff, 0xfe, 0x78, 0x00, 0x0a]);
  await writeFile(path.join(f.folder, "garbled_utf8.txt"), bytes);
  await writeFile(path.join(f.folder, "valid.txt"), "An independent synthetic document.");
  const scan = await scanBridgeRoot(f.rootId);
  assert.equal(scan.totalFiles, 2);
  const startedAt = Date.now();
  await assert.rejects(
    withBoundedTemporaryRead(readBridgeRootFile(f.rootId, "garbled_utf8.txt"), 4_000),
    (error) => error instanceof BridgeAppError && error.code === "FILE_INVALID_ENCODING",
  );
  assert.ok(Date.now() - startedAt < 4_000, "corrupt bytes must not monopolize reading");
  const good = await withBoundedTemporaryRead(readBridgeRootFile(f.rootId, "valid.txt"), 4_000);
  assert.equal(good.extractedText, "An independent synthetic document.");
  assert.equal(good.sourceChecksum, createHash("sha256").update("An independent synthetic document.").digest("hex"));
});

test("#8 client archives resist broad Clinical Tools grouping and renaming cannot inflate move confidence", () => {
  const archive = "00_EXISTING_ARCHIVE/Harbor_Fern_Alliance/Restorative_Practices/RPR_03_Participant_worksheet.md";
  const dialogue = "08_DEEP_ARCHIVES/HFA/Dialogue_Samples/RPR_Session_1.txt";
  for (const item of [archive, dialogue]) {
    assert.equal(suppressBroadCategoryMove(item, "Clinical Tools"), true);
  }
  assert.equal(suppressBroadCategoryMove("01_MIXED_INBOX/Downloads/Document_005_untitled.txt", "Clinical Tools"), false);
  const defaults: RecommendationDraft = {
    alternatives: [], duplicateEvidence: [], requiredFolderPaths: [], supportingInformation: [],
    explanation: "Synthetic independent evidence", whySuggested: ["Synthetic only"],
    confidence: 0.66, evidenceStrength: "SUPPORTED",
    suggestionType: "MOVE_FILE", title: "Move", proposedRelativePath: "Clinical Tools/worksheet.txt",
  };
  const renamed: RecommendationDraft = {
    ...defaults,
    suggestionType: "RENAME_FILE", title: "Rename",
    proposedRelativePath: null, proposedFileName: "client_workbook.txt",
    confidence: 0.83, evidenceStrength: "STRONG",
  };
  const result = reconcileRecommendationDrafts("01_MIXED_INBOX/Downloads/worksheet.txt", [defaults, renamed]);
  const decision = result.find(d => d.suggestionType === "MOVE_FILE");
  assert.ok(decision);
  assert.equal(decision.confidence, 0.66);
  assert.equal(decision.evidenceStrength, "SUPPORTED");
});

test("#11 exact authorized synthetic execution and Undo restore the complete tree, preserving unrelated replacement", async (t) => {
  const f = await fixture(t);
  const content = "Disposable explicitly authorized acceptance worksheet.\n";
  const checksum = createHash("sha256").update(content).digest("hex");
  await writeFile(path.join(f.folder, "worksheet.txt"), content);
  const plan: BridgeExecutionPlanAction[] = [
    { id: "approved-folder", actionType: "CREATE_FOLDER", destinationRelativePath: "Filed" },
    { id: "approved-move", actionType: "MOVE_FILE", sourceRelativePath: "worksheet.txt",
      destinationRelativePath: "Filed/worksheet.txt", sourceChecksum: checksum },
  ];
  assert.equal((await previewBridgeExecution(f.rootId, plan)).canExecute, true);
  const executed = await executeBridgePlanActions(f.rootId, plan, f.revision);
  assert.equal(executed.status, "COMPLETED");
  assert.equal(executed.completedActions, 2);
  assert.equal(await readFile(path.join(f.folder, "Filed", "worksheet.txt"), "utf8"), content);

  const undo: BridgeUndoPlanAction[] = [
    { id: "undo-move", actionType: "MOVE_FILE", originalExecutionActionId: "approved-move",
      sourceRelativePath: "Filed/worksheet.txt", destinationRelativePath: "worksheet.txt", sourceChecksum: checksum },
    { id: "undo-folder", actionType: "REMOVE_FOLDER", originalExecutionActionId: "approved-folder",
      sourceRelativePath: "Filed", destinationRelativePath: "Filed" },
  ];
  assert.equal((await previewBridgeUndo(f.rootId, undo)).canUndo, true);
  const restored = await executeBridgeUndoActions(f.rootId, undo, f.revision);
  assert.equal(restored.status, "COMPLETED");
  assert.equal(restored.completedActions, 2);
  assert.equal((await stat(path.join(f.folder, "worksheet.txt"))).isFile(), true);
  assert.equal(createHash("sha256").update(await readFile(path.join(f.folder, "worksheet.txt")).digest("hex"), checksum);
  assert.deepEqual(await readdir(f.folder), ["worksheet.txt"]);
  assert.equal(await inspectUndoFolderName(f.folder, "Filed"), "ABSENT");

  // Simulate a foreign sync provider occupying the old name after Undo. The
  // historical journal must not delete any externally recreated directory.
  await mkdir(path.join(f.folder, "Filed"));
  await writeFile(path.join(f.folder, "Filed", "external.txt"), "Unrelated external content.");
  assert.equal(await inspectUndoFolderName(f.folder, "Filed"), "REOCCUPIED");
  assert.equal((await recoverPhysicalAction(`undo:${f.rootId}:undo-folder`))?.state, "COMPLETED");
  assert.equal(await readFile(path.join(f.folder, "Filed", "external.txt"), "utf8"), "Unrelated external content.");
});

test("#12 the Mac native scanner distinguishes one eligible file from a truly empty directory", async (t) => {
  const f = await fixture(t);
  const empty = await scanBridgeRoot(f.rootId);
  assert.equal(empty.totalFiles, 0);
  assert.equal(empty.files.length, 0);
  await writeFile(path.join(f.folder, "synthetic_client_worksheet.txt"), "One known supported worksheet.\n");
  await writeFile(path.join(f.folder, ".hidden-ignore"), "Hidden synthetic note.");
  const full = await scanBridgeRoot(f.rootId);
  assert.equal(full.totalFiles, 1);
  assert.equal(full.supportedFiles, 1);
  assert.equal(full.failedFiles, 0);
  assert.deepEqual(full.files.map(x => x.relativePath), ["synthetic_client_worksheet.txt"]);
  assert.match(full.files[0]!.checksum ?? "", /^[a-f0-9]{64}$/);
  assert.equal(full.files[0]!.readStatus, "SUPPORTED");
});
