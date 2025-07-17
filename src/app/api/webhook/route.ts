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
							// Only process text messages
							if (message.type === "text") {
								const from = message.from;
								const messageContent = message.text?.body || "";

								console.log(`Message from ${from}: ${messageContent}`);

								// Send reply message
								await sendReplyMessage(from, messageContent);
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

// Function to send reply message
async function sendReplyMessage(to: string, originalContent: string) {
	try {
		const replyMessage = `content readed: ${originalContent}`;

		const payload = {
			messaging_product: "whatsapp",
			to: to,
			type: "text",
			text: {
				body: replyMessage,
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
