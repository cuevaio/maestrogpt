import { CoreMessage, generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { vector } from "@/clients/vector";
import { downloadWhatsAppMedia } from "@/lib/download-whatsapp-media";

// Function to send reply message
export async function generateResponse(
	originalContent: string,
	imageId?: string | null,
) {
	try {
		const messages: CoreMessage[] = [
			{
				role: "system",
				content:
					"You are a helpful assistant that can answer questions and help with tasks related to construction. Answer in natural, easy to follow language. Your target users are builders. Answer in the same language as the question. Your name is MaestroGPT. You have access to a knowledge base of construction-related information. You can use the searchKnowledge tool to search the knowledge base for relevant information. Always indicate which pages of the knowledge base were used to answer the question. When needed, add a disclaimer that the information is based on the knowledge base and may not be up to date. Also, add a disclaimer that the information is not a substitute for professional advice.",
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
							const results = await Promise.all(
								queries.map((query) =>
									vector.query<{
										pageIndex: number;
										chunkIndex: number;
									}>({
										topK: 3,
										data: query,
										includeMetadata: true,
										includeVectors: false,
										includeData: false,
									}),
								),
							);

							const pagesIndexes: number[] = [];
							for (const result of results) {
								for (const r of result) {
									if (r.metadata?.pageIndex) {
										pagesIndexes.push(r.metadata.pageIndex);
									}
								}
							}

							const pagesResults = await Promise.all(
								pagesIndexes.map((pageIndex) =>
									vector.fetch<{
										pageIndex: number;
										chunkIndex: number;
									}>(
										{ prefix: `${pageIndex}-` },
										{
											includeData: true,
											includeMetadata: true,
											includeVectors: false,
										},
									),
								),
							);

							const pages: {
								pageIndex: number;
								chunks: {
									chunkIndex: number;
									content: string;
								}[];
							}[] = [];

							for (const pageResult of pagesResults) {
								for (const chunk of pageResult) {
									if (
										chunk?.metadata?.pageIndex &&
										chunk?.metadata?.chunkIndex &&
										chunk?.data
									) {
										if (
											!pages.find(
												(p) => p.pageIndex === chunk.metadata?.pageIndex,
											)
										) {
											pages.push({
												pageIndex: chunk.metadata.pageIndex,
												chunks: [
													{
														chunkIndex: chunk.metadata.chunkIndex,
														content: chunk.data,
													},
												],
											});
										} else {
											pages
												.find((p) => p.pageIndex === chunk.metadata?.pageIndex)
												?.chunks.push({
													chunkIndex: chunk.metadata.chunkIndex,
													content: chunk.data,
												});
										}
									}
								}
							}

							let content =
								"The following is a list of pages that may be relevant to the query:";

							for (const page of pages) {
								content += `\n# Page ${page.pageIndex}\n`;

								content += page.chunks
									.toSorted((a, b) => a.chunkIndex - b.chunkIndex)
									.map((chunk) => chunk.content)
									.join("\n");
							}

							return content;
						} catch (error) {
							console.error("Error searching knowledge base:", error);
							return "Nothing found";
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
