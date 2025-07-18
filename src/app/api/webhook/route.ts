import { vector } from "@/clients/vector";
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateText, tool } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// WhatsApp API configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// GET handler for webhook verification
export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);

	const mode = searchParams.get("hub.mode");
	const token = searchParams.get("hub.verify_token");
	const challenge = searchParams.get("hub.challenge");

	// Verify the webhook
	if (mode === "subscribe" && token === VERIFY_TOKEN) {
		console.log("Webhook verified successfully");
		return new NextResponse(challenge, { status: 200 });
	} else {
		console.log("Webhook verification failed");
		return new NextResponse("Forbidden", { status: 403 });
	}
}

// POST handler for incoming messages
export async function POST(request: NextRequest) {
	try {
		const body = await request.json();

		// Log the incoming webhook data
		console.log("Incoming webhook:", JSON.stringify(body, null, 2));

		// Check if this is a message webhook
		if (body.object === "whatsapp_business_account") {
			const entries = body.entry || [];

			for (const entry of entries) {
				const changes = entry.changes || [];

				for (const change of changes) {
					if (change.field === "messages") {
						const messages = change.value?.messages || [];

						for (const message of messages) {
							console.log(message);

							const from = message.from;

							// Process both text and image messages
							if (message.type === "text") {
								const messageContent = message.text?.body || "";
								console.log(`Text message from ${from}: ${messageContent}`);
								await sendReplyMessage(from, messageContent, null);
							} else if (message.type === "image") {
								const imageId = message.image?.id;
								const caption = message.image?.caption || "";
								console.log(
									`Image message from ${from}, image ID: ${imageId}, caption: ${caption}`,
								);

								if (imageId) {
									await sendReplyMessage(
										from,
										caption ||
											"Please analyze this construction-related image and provide helpful insights for builders.",
										imageId,
									);
								}
							}
						}
					}
				}
			}
		}

		return NextResponse.json({ status: "success" }, { status: 200 });
	} catch (error) {
		console.error("Error processing webhook:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

// Function to download media from WhatsApp
async function downloadWhatsAppMedia(mediaId: string): Promise<string | null> {
	try {
		// First, get the media URL
		const mediaResponse = await fetch(
			`https://graph.facebook.com/v22.0/${mediaId}`,
			{
				headers: {
					Authorization: `Bearer ${WHATSAPP_TOKEN}`,
				},
			},
		);

		if (!mediaResponse.ok) {
			console.error("Failed to get media URL:", mediaResponse.status);
			return null;
		}

		const mediaData = await mediaResponse.json();
		const mediaUrl = mediaData.url;

		// Download the actual media file
		const fileResponse = await fetch(mediaUrl, {
			headers: {
				Authorization: `Bearer ${WHATSAPP_TOKEN}`,
			},
		});

		if (!fileResponse.ok) {
			console.error("Failed to download media:", fileResponse.status);
			return null;
		}

		// Convert to base64
		const arrayBuffer = await fileResponse.arrayBuffer();
		const base64 = Buffer.from(arrayBuffer).toString("base64");
		const mimeType = fileResponse.headers.get("content-type") || "image/jpeg";

		return `data:${mimeType};base64,${base64}`;
	} catch (error) {
		console.error("Error downloading media:", error);
		return null;
	}
}

// Function to send reply message
async function sendReplyMessage(
	to: string,
	originalContent: string,
	imageId?: string | null,
) {
	try {
		const messages: CoreMessage[] = [
			{
				role: "system",
				content:
					"You are a helpful assistant that can answer questions and help with tasks related to construction. Answer in natural, easy to follow language. Your target users are builders. Answer in the same language as the question. Your name is MaestroGPT. You have access to a knowledge base of construction-related information. You can use the searchKnowledge tool to search the knowledge base for relevant information. Always indicate which pages of the knowledge base were used to answer the question.",
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

		console.log("AI response:", aiResponse.text);

		const payload = {
			messaging_product: "whatsapp",
			to: to,
			type: "text",
			text: {
				body: aiResponse.text,
			},
			name: "MaestroGPT",
		};

		const response = await fetch(
			`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${WHATSAPP_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			},
		);

		if (!response.ok) {
			const errorData = await response.text();
			console.error("Failed to send message:", response.status, errorData);
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const result = await response.json();
		console.log("Message sent successfully:", result);

		return result;
	} catch (error) {
		console.error("Error sending reply message:", error);
		throw error;
	}
}
