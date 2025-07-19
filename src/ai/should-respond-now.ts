import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import type { ConversationMessage } from "./generate-reponse";

export async function shouldRespondNow(
  currentMessage: string,
  conversationHistory: ConversationMessage[] = [],
  hasImage: boolean = false,
): Promise<boolean> {
  // Get recent messages (last 10 messages or last 5 minutes)
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentMessages = conversationHistory
    .filter((msg) => msg.timestamp > fiveMinutesAgo)
    .slice(-10);

  // Format conversation context for analysis with timestamps
  let conversationContext = "";
  if (recentMessages.length > 0) {
    conversationContext =
      "Recent conversation (with timestamps):\n" +
      recentMessages
        .map((msg) => {
          const date = new Date(msg.timestamp);
          const timeStr = date.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });

          // Show "[Image attached]" for image-only messages
          let displayContent = msg.content;
          if (msg.imageId && !msg.content.trim()) {
            displayContent = "[Image attached]";
          } else if (msg.imageId && msg.content.trim()) {
            displayContent = `${msg.content} [Image attached]`;
          }

          return `[${timeStr}] ${msg.role}: ${displayContent}`;
        })
        .join("\n") +
      "\n";
  }

  const currentTime = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Show "[Image attached]" for image-only messages, consistent with history
  let currentMessageDisplay = currentMessage;
  if (hasImage && !currentMessage.trim()) {
    currentMessageDisplay = "[Image attached]";
  } else if (hasImage && currentMessage.trim()) {
    currentMessageDisplay = `${currentMessage} [Image attached]`;
  }

  conversationContext += `[${currentTime}] Current message: ${currentMessageDisplay}`;

  const prompt = `You are analyzing a WhatsApp conversation to decide if an AI assistant should respond now or wait for more messages.

CORE PRINCIPLE: If the current message contains a clear, complete question or request, RESPOND NOW. Don't overthink it.

RESPOND NOW if:
• Complete questions (ends with ?, asks for advice/recommendations)
• Clear requests for help or information
• Greetings or acknowledgments
• Image-only messages (user expects analysis)
• Messages that feel complete and coherent

WAIT if:
• Message ends with connecting words ("and", "also", "because", "but", "y")
• Message is clearly incomplete or cut off mid-sentence
• Very brief messages without clear intent (unless they're complete questions)
• Empty messages without images
• User is obviously building up to something more

KEY EXAMPLES:

RESPOND NOW:
• "What recommendations would you give me for pouring a foundation?" → Clear complete question
• "Should I be worried? What could it be?" → Direct questions
• "Hello" → Simple greeting
• "Thanks for the advice" → Clear acknowledgment
• "[Image attached]" → Visual information shared
• "What is your name?" → Direct question

WAIT:
• "Hi doctor, I have been having some pain in my" → Clearly incomplete
• "I've been feeling sick" → Too brief, likely more coming
• "And also" → Obviously more information coming
• "Let me send you" → About to send something
• "Oye y" → "Hey and" - incomplete connector

CRITICAL: A complete question like "What recommendations would you give me for X?" should ALWAYS get a response, even if the previous message was incomplete.

ANALYZE THIS CONVERSATION:
${conversationContext}

Focus on: Is the current message a complete thought that deserves a response? Don't overthink the context - prioritize clear questions and requests.`;

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      output: "enum",
      enum: ["respond_now", "wait_for_more"],
      prompt: prompt,
    });

    const shouldRespond = object !== "wait_for_more";
    console.log(
      `AI Decision: ${object} for message: "${currentMessage}" (hasImage: ${hasImage})`,
    );

    console.log(conversationContext);
    return shouldRespond;
  } catch (error) {
    console.error("Error in shouldRespondNow:", error);
    // Default to responding if AI decision fails
    return true;
  }
}
