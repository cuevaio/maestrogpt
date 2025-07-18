import { CoreMessage, generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { vector } from "@/clients/vector";
import { downloadWhatsAppMedia } from "@/lib/download-whatsapp-media";
import { SYSTEM_PROMPT } from "./system-prompt";

// Function to send reply message
export async function generateResponse(
	originalContent: string,
	imageId?: string | null,
) {
	try {
		const messages: CoreMessage[] = [
			{
				role: "system",
				content: SYSTEM_PROMPT,
			},
		];

		if (imageId) {
			// Handle image message
			const imageData = await downloadWhatsAppMedia(imageId);

			if (!imageData) {
				throw new Error("Failed to download image");
			}

			messages.push({
				role: "user",
				content: [
					{
						type: "text",
						text: originalContent,
					},
					{
						type: "image",
						image: imageData,
						providerOptions: {
							openai: { imageDetail: "low" },
						},
					},
				],
			});
		} else {
			messages.push({
				role: "user",
				content: originalContent,
			});
		}

		const aiResponse = await generateText({
			model: openai("gpt-4.1"),
			messages: messages,
			maxSteps: 10,
			tools: {
				searchKnowledge: tool({
					description: "Search the knowledge base for relevant information",
					parameters: z.object({
						queries: z.array(z.string()),
					}),
					execute: async ({ queries }) => {
						try {
							// Search for relevant chunks
							const results = await Promise.all(
								queries.map((query) =>
									vector.query<{
										pageIndex: number;
										chunkIndex: number;
									}>({
										topK: 5, // Get more relevant chunks
										data: query,
										includeMetadata: true,
										includeVectors: false,
										includeData: true, // Get data directly
									}),
								),
							);

							// Collect unique chunks with their context
							const relevantChunks = new Map<string, {
								pageIndex: number;
								chunkIndex: number;
								content: string;
								score: number;
							}>();

							for (const result of results) {
								for (const r of result) {
									if (r.metadata?.pageIndex && r.metadata?.chunkIndex && r.data) {
										const key = `${r.metadata.pageIndex}-${r.metadata.chunkIndex}`;
										if (!relevantChunks.has(key)) {
											relevantChunks.set(key, {
												pageIndex: r.metadata.pageIndex,
												chunkIndex: r.metadata.chunkIndex,
												content: r.data,
												score: r.score || 0,
											});
										}
									}
								}
							}

							// Sort by relevance score and take top 6 chunks
							const sortedChunks = Array.from(relevantChunks.values())
								.sort((a, b) => b.score - a.score)
								.slice(0, 6);

							// For each relevant chunk, get previous and next chunks for context
							const chunksWithContext = await Promise.all(
								sortedChunks.map(async (chunk) => {
									const contextChunks = await Promise.all([
										// Previous chunk
										vector.fetch<{
											pageIndex: number;
											chunkIndex: number;
										}>(
											[`${chunk.pageIndex}-${chunk.chunkIndex - 1}`],
											{
												includeData: true,
												includeMetadata: true,
												includeVectors: false,
											},
										),
										// Current chunk (already have it but fetch for consistency)
										vector.fetch<{
											pageIndex: number;
											chunkIndex: number;
										}>(
											[`${chunk.pageIndex}-${chunk.chunkIndex}`],
											{
												includeData: true,
												includeMetadata: true,
												includeVectors: false,
											},
										),
										// Next chunk
										vector.fetch<{
											pageIndex: number;
											chunkIndex: number;
										}>(
											[`${chunk.pageIndex}-${chunk.chunkIndex + 1}`],
											{
												includeData: true,
												includeMetadata: true,
												includeVectors: false,
											},
										),
									]);

									const contextContent = contextChunks
										.flat()
										.filter((c): c is NonNullable<typeof c> & { data: string } => !!c?.data)
										.sort((a, b) => (a.metadata?.chunkIndex || 0) - (b.metadata?.chunkIndex || 0))
										.map(c => c.data)
										.join(" ");

									return {
										pageIndex: chunk.pageIndex,
										content: contextContent || chunk.content,
									};
								})
							);

							// Group by page and format output
							const pageGroups = new Map<number, string[]>();
							for (const chunk of chunksWithContext) {
								if (!pageGroups.has(chunk.pageIndex)) {
									pageGroups.set(chunk.pageIndex, []);
								}
								pageGroups.get(chunk.pageIndex)?.push(chunk.content);
							}

							let formattedContent = "Información relevante encontrada:\n\n";

							for (const [pageIndex, contents] of pageGroups) {
								const uniqueContents = [...new Set(contents)]; // Remove duplicates
								for (const content of uniqueContents) {
									formattedContent += `**Encontrado en página ${pageIndex}:**\n${content}\n\n`;
								}
							}

							return formattedContent;
						} catch (error) {
							console.error("Error searching knowledge base:", error);
							return "No se encontró información relevante en la base de conocimientos.";
						}
					},
				}),
			},
		});

		return aiResponse.text;
	} catch (error) {
		console.error("Error sending reply message:", error);
		throw error;
	}
}
