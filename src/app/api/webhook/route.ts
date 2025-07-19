import { type NextRequest, NextResponse } from "next/server";
import { generateResponse } from "@/ai/generate-reponse";
import { shouldRespondNow } from "@/ai/should-respond-now";
import { getConversationHistory, storeMessage } from "@/lib/conversation";

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

    let from = "";
    let messageContent = "";
    let imageId = "";

    // Check if this is a message webhook
    if (body.object === "whatsapp_business_account") {
      const entries = body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          if (change.field === "messages") {
            const messages = change.value?.messages || [];

            for (const message of messages) {
              if (message.from) {
                from = message.from;
              }

              // Process both text and image messages
              if (message.type === "text") {
                messageContent = message.text?.body || "";
              } else if (message.type === "image") {
                imageId = message.image?.id;
                const caption = message.image?.caption || "";
                if (caption) {
                  messageContent += `\n\nImage caption: ${caption}`;
                }
              }
            }
          }
        }
      }
    }

    if (!from) {
      console.log("No from found");
      return NextResponse.json({ status: "success" }, { status: 200 });
    }

    // Get conversation history for context
    const conversationHistory = await getConversationHistory(from);

    // Use AI to decide if we should respond now or wait for more messages
    const shouldAnswer = await shouldRespondNow(
      messageContent,
      conversationHistory,
      !!imageId,
    );

    // Store the incoming user message (regardless of whether we respond)
    await storeMessage(from, {
      role: "user",
      content: messageContent,
      timestamp: Date.now(),
      imageId: imageId || undefined,
    });

    if (!shouldAnswer) {
      console.log("AI decided to wait for more messages");
      return NextResponse.json({ status: "success" }, { status: 200 });
    }

    // Get updated conversation history that includes the current message
    const updatedConversationHistory = await getConversationHistory(from);

    // Generate AI response with updated conversation context
    const aiResponse = await generateResponse(updatedConversationHistory);

    // Store the AI response
    await storeMessage(from, {
      role: "assistant",
      content: aiResponse,
      timestamp: Date.now(),
    });

    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: {
        body: aiResponse,
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

    return NextResponse.json({ status: "success" }, { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
