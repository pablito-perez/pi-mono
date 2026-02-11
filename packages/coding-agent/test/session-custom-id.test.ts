import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SessionHeader } from "../src/core/session-manager.js";
import { SessionManager } from "../src/core/session-manager.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function appendUserAndAssistant(mgr: SessionManager, text = "test"): void {
	mgr.appendMessage({
		role: "user",
		timestamp: Date.now(),
		content: [{ type: "text", text }],
	});
	mgr.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "response" }],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	});
}

describe("SessionManager custom session ID", () => {
	let testDir: string;

	beforeAll(() => {
		initTheme("dark");
		testDir = join(tmpdir(), `pi-test-custom-id-${Date.now()}`);
		if (!existsSync(testDir)) {
			mkdirSync(testDir, { recursive: true });
		}
	});

	afterEach(() => {
		// Cleanup is handled by tmpdir - files are ephemeral
	});

	it("creates session with valid custom ID", () => {
		const customId = "my-feature-123";
		const mgr = SessionManager.create(testDir, testDir, customId);

		expect(mgr.getSessionId()).toBe(customId);

		const header = mgr.getHeader();
		expect(header).toBeDefined();
		expect(header!.id).toBe(customId);
	});

	it("persists custom ID to session file", () => {
		const customId = "test-session-456";
		const mgr = SessionManager.create(testDir, testDir, customId);

		// Add user + assistant messages to trigger persistence
		appendUserAndAssistant(mgr);

		const sessionFile = mgr.getSessionFile();
		expect(sessionFile).toBeDefined();

		// Read the file and verify header
		const content = readFileSync(sessionFile!, "utf8");
		const firstLine = content.split("\n")[0];
		const header = JSON.parse(firstLine) as SessionHeader;

		expect(header.type).toBe("session");
		expect(header.id).toBe(customId);
		expect(header.version).toBe(3);
	});

	it("rejects ID with spaces", () => {
		expect(() => {
			SessionManager.create(testDir, testDir, "invalid id with spaces");
		}).toThrow(/must contain only letters, numbers, hyphens, and underscores/);
	});

	it("rejects ID with special characters", () => {
		expect(() => {
			SessionManager.create(testDir, testDir, "invalid/id");
		}).toThrow(/must contain only letters, numbers, hyphens, and underscores/);

		expect(() => {
			SessionManager.create(testDir, testDir, "invalid@id");
		}).toThrow(/must contain only letters, numbers, hyphens, and underscores/);

		expect(() => {
			SessionManager.create(testDir, testDir, "invalid.id");
		}).toThrow(/must contain only letters, numbers, hyphens, and underscores/);
	});

	it("rejects ID that is too short", () => {
		expect(() => {
			SessionManager.create(testDir, testDir, "ab");
		}).toThrow(/must be between 3 and 64 characters/);
	});

	it("rejects ID that is too long", () => {
		const longId = "a".repeat(65);
		expect(() => {
			SessionManager.create(testDir, testDir, longId);
		}).toThrow(/must be between 3 and 64 characters/);
	});

	it("accepts ID with hyphens and underscores", () => {
		const validIds = ["test-id", "test_id", "test-123_abc", "feature-work_2024"];

		for (const customId of validIds) {
			const dir = join(testDir, customId);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			const mgr = SessionManager.create(testDir, dir, customId);
			expect(mgr.getSessionId()).toBe(customId);
		}
	});

	it("detects collision with existing session ID", () => {
		const customId = "collision-test";
		const collisionDir = join(testDir, "collision");

		if (!existsSync(collisionDir)) {
			mkdirSync(collisionDir, { recursive: true });
		}

		// Create first session and persist it
		const mgr1 = SessionManager.create(testDir, collisionDir, customId);
		appendUserAndAssistant(mgr1, "first");

		// Try to create second session with same ID
		expect(() => {
			SessionManager.create(testDir, collisionDir, customId);
		}).toThrow(/already exists in this directory/);
	});

	it("allows same ID in different directories", () => {
		const customId = "shared-id";

		const dir1 = join(testDir, "dir1");
		const dir2 = join(testDir, "dir2");

		if (!existsSync(dir1)) mkdirSync(dir1, { recursive: true });
		if (!existsSync(dir2)) mkdirSync(dir2, { recursive: true });

		// Should succeed - different directories
		const mgr1 = SessionManager.create(testDir, dir1, customId);
		const mgr2 = SessionManager.create(testDir, dir2, customId);

		expect(mgr1.getSessionId()).toBe(customId);
		expect(mgr2.getSessionId()).toBe(customId);
	});

	it("verifies custom ID in filename", () => {
		const customId = "filename-test";
		const mgr = SessionManager.create(testDir, testDir, customId);

		mgr.appendMessage({
			role: "user",
			timestamp: Date.now(),
			content: [{ type: "text", text: "test" }],
		});

		const sessionFile = mgr.getSessionFile();
		expect(sessionFile).toBeDefined();
		expect(sessionFile!).toContain(customId);
		expect(sessionFile!).toMatch(/_filename-test\.jsonl$/);
	});

	it("can reopen session by custom ID prefix", async () => {
		const customId = "reopen-test-123";
		const mgr = SessionManager.create(testDir, testDir, customId);

		appendUserAndAssistant(mgr, "initial message");

		const sessionFile = mgr.getSessionFile();
		expect(sessionFile).toBeDefined();

		// List sessions and find by ID
		const sessions = await SessionManager.list(testDir, testDir);
		const found = sessions.find((s) => s.id === customId);

		expect(found).toBeDefined();
		expect(found!.id).toBe(customId);
		expect(found!.path).toBe(sessionFile);
	});

	it("validates ID format before creating session file", () => {
		// Ensure validation happens before any file I/O
		expect(() => {
			SessionManager.create(testDir, testDir, "../../../etc/passwd");
		}).toThrow(/must contain only letters, numbers, hyphens, and underscores/);

		// Verify no file was created
		const files = existsSync(testDir) ? require("fs").readdirSync(testDir) : [];
		const suspiciousFiles = files.filter((f: string) => f.includes("etc") || f.includes("passwd"));
		expect(suspiciousFiles).toHaveLength(0);
	});

	it("works with newSession() method directly", () => {
		const customId = "direct-new-session";
		const mgr = SessionManager.create(testDir, testDir);

		// Call newSession with custom ID
		mgr.newSession({ customId });

		expect(mgr.getSessionId()).toBe(customId);
	});

	it("handles edge case: minimum length ID", () => {
		const customId = "abc";
		const mgr = SessionManager.create(testDir, testDir, customId);
		expect(mgr.getSessionId()).toBe(customId);
	});

	it("handles edge case: maximum length ID", () => {
		const customId = "a".repeat(64);
		const mgr = SessionManager.create(testDir, testDir, customId);
		expect(mgr.getSessionId()).toBe(customId);
	});

	it("preserves custom ID across session operations", () => {
		const customId = "preserve-test";
		const mgr = SessionManager.create(testDir, testDir, customId);

		// Perform various operations
		mgr.appendMessage({
			role: "user",
			timestamp: Date.now(),
			content: [{ type: "text", text: "message 1" }],
		});

		mgr.appendThinkingLevelChange("high");

		mgr.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "response" }],
			api: "openai-completions",
			provider: "openai",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});

		// ID should remain unchanged
		expect(mgr.getSessionId()).toBe(customId);

		const header = mgr.getHeader();
		expect(header!.id).toBe(customId);
	});
});
