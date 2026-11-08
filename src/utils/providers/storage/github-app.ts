/**
 * GitHub App storage adapter.
 *
 * Thin wrapper over the existing GitHub helpers. Nothing above this layer knows that files
 * live in a git repository; swapping in GitLab, S3/R2, or a database means implementing the
 * same interface and registering it in `registry.ts`.
 */

import {
	commitFiles,
	deleteFileFromGitHub,
	getConfig,
	getPrivateKey,
	listAllMarkdownFiles,
	listFilesFromGitHub,
	listMarkdownWithSha,
	readFileFromGitHub,
	resolvePostPath,
	saveFileToGitHub,
	testGitHubConnection,
} from "../../github-app";
import type {
	StorageCommitResult,
	StorageEntry,
	StorageFileChange,
	StorageProvider,
	StorageReadResult,
} from "../types";

export const githubAppStorageProvider: StorageProvider = {
	id: "github",
	label: "GitHub App",

	isConfigured(): boolean {
		try {
			const { appId, owner, repo, installationId } = getConfig();
			if (!appId || !owner || !repo || !installationId) return false;
			return getPrivateKey().length > 0;
		} catch {
			return false;
		}
	},

	readFile(filePath: string): Promise<StorageReadResult> {
		return readFileFromGitHub(filePath) as Promise<StorageReadResult>;
	},

	writeFile(filePath: string, content: string, message: string): Promise<boolean> {
		return saveFileToGitHub(filePath, content, message);
	},

	async deleteFile(filePath: string, message: string): Promise<boolean> {
		await deleteFileFromGitHub(filePath, message);
		return true;
	},

	listFiles(directory: string): Promise<StorageEntry[]> {
		return listFilesFromGitHub(directory);
	},

	commitFiles(
		files: StorageFileChange[],
		message: { headline: string; body?: string },
	): Promise<StorageCommitResult> {
		return commitFiles(files, message);
	},

	listMarkdownWithSha(
		directory: string,
	): Promise<Array<{ path: string; sha: string }>> {
		return listMarkdownWithSha(directory);
	},

	listMarkdownPaths(directory: string): Promise<string[]> {
		return listAllMarkdownFiles(directory);
	},

	resolvePath(slug: string): Promise<string | null> {
		return resolvePostPath(slug);
	},

	testConnection(): Promise<number> {
		return testGitHubConnection();
	},
};
