import assert from "node:assert/strict";
import test from "node:test";
import { archiveSuggestionPathAllowed, suppressBroadCategoryMove } from "../../src/lib/bridge/organization-suggestions";

test("client, project and existing archive hierarchies are not flattened by generic clinical terms", () => {
  for (const source of [
    "00_EXISTING_ARCHIVE/Harbor_Fern_Alliance/Restorative_Practices/worksheet.md",
    "08_DEEP_ARCHIVES/HFA/Dialogue_Samples/RPR_Session_1.txt",
    "Client_A/Notes/file.md",
    "Client_A/Inbox/worksheet.md",
    "Archive/file.txt",
  ]) {
    assert.equal(suppressBroadCategoryMove(source, "Clinical Tools"), true, source);
    assert.equal(suppressBroadCategoryMove(source, "Workshops"), true, source);
    assert.equal(suppressBroadCategoryMove(source, "Clinical Tools", true), false,
      "An exact human-approved destination preference may authorize a new suggestion.");
  }
});

test("unstructured inbox files receive cautious suggestions without erasing named hierarchies", () => {
  for (const source of [
    "Download_001.txt",
    "Downloads/worksheet.txt",
    "01_MIXED_INBOX/Downloads/Document_005_untitled.txt",
    "Inbox/Unsorted/notes.txt",
  ]) {
    assert.equal(suppressBroadCategoryMove(source, "Clinical Tools"), false, source);
  }
  assert.equal(suppressBroadCategoryMove("Client_A/Notes/file.txt", "Client_A/Workshops"), false,
    "Moving to a specifically scoped subfolder is evaluated by separate identity and permission checks.");
});

test("archive scope applies to media, group moves, and alternatives, not just document rules", () => {
  const owner = "00_EXISTING_ARCHIVE/Harbor_Fern_Alliance/Restorative_Practices/workshop.mp3";
  assert.equal(archiveSuggestionPathAllowed(owner, "Audio/Workshops/workshop.mp3"), false);
  assert.equal(archiveSuggestionPathAllowed(owner, "Video/Interviews/recording.mov"), false);
  assert.equal(archiveSuggestionPathAllowed(owner, "00_EXISTING_ARCHIVE/Juniper_Kite_Collective/Clinical Tools/workshop.mp3"), false);
  assert.equal(archiveSuggestionPathAllowed(owner, "00_EXISTING_ARCHIVE/Harbor_Fern_Alliance/Clinical Tools/workshop.mp3"), true);
  assert.equal(archiveSuggestionPathAllowed(owner, "Audio/Workshops/workshop.mp3", ["Audio/Workshops"]), true);
  assert.equal(archiveSuggestionPathAllowed("01_MIXED_INBOX/Downloads/workshop.mp3", "Audio/Workshops/workshop.mp3"), true);
  assert.equal(archiveSuggestionPathAllowed(owner, null), true);
});
