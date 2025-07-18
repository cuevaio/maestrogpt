import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";

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
								console.log(`Image message from ${from}, image ID: ${imageId}`);

								if (imageId) {
									await sendReplyMessage(
										from,
										"Analyzing your image...",
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
		let aiResponse: { text: string };

		if (imageId) {
			// Handle image message
			const imageData = await downloadWhatsAppMedia(imageId);

			if (!imageData) {
				aiResponse = {
					text: "Sorry, I couldn't process your image. Please try again.",
				};
			} else {
				const result = await generateText({
					model: openai("gpt-4o"),
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text:
										originalContent ||
										"Please analyze this construction-related image and provide helpful insights for builders.",
								},
								{
									type: "image",
									image: imageData,
									providerOptions: {
										openai: { imageDetail: "low" },
									},
								},
							],
						},
					],
				});
				aiResponse = result;
			}
		} else {
			// Handle text message
			aiResponse = await generateText({
				model: openai("gpt-4o"),
				system:
					"Your name is MaestroGPT. Your role is to answer questions about construction. Answer in natural, easy to follow language. Your target users are builders. Answer in the same language as the question.",
				prompt: originalContent,
			});
		}

		const payload = {
			messaging_product: "whatsapp",
			to: to,
			type: "text",
			text: {
				body: aiResponse.text,
			},
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
