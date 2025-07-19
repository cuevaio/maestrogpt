import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
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

CONTEXT: Users often send their medical/health consultations in multiple short messages instead of one long message. We want to avoid responding too early before they finish explaining their complete situation.

DECISION CRITERIA:
- RESPOND NOW if:
  * Message asks a direct question (ends with ?, starts with question words)
  * Message seems complete and coherent
  * User indicates they're done explaining
  * Simple greetings or acknowledgments
  * Questions about identity, names, or basic info
  * Image-only messages (user likely expects analysis/response)
  * Message has clear intent even if brief

- WAIT if:
  * Message seems incomplete or cut off
  * Ends with connecting words ("and", "also", "because", "but")
  * User is clearly building up to something
  * Message is very brief without clear intent
  * Empty message without image
  * User appears to be typing more (based on timing patterns)

EXAMPLES:

Example 1 - WAIT:
"Hi doctor, I have been having some pain in my"
→ Clearly incomplete, likely more coming

Example 2 - RESPOND NOW:
"Hi doctor, I have been having headaches for 3 days. They get worse in the evening and I've tried paracetamol but it doesn't help. What should I do?"
→ Complete description with clear question

Example 3 - WAIT:
"I've been feeling sick"
→ Too brief, likely more details coming

Example 4 - RESPOND NOW:
"Thanks for the advice, I'll try that"
→ Clear acknowledgment/conclusion

Example 5 - WAIT:
Recent: "Hi doctor"
Current: "I need help with"
→ Clearly building up to something

Example 6 - RESPOND NOW:
Recent: "I've been having stomach pain"
Recent: "It started yesterday"
Recent: "After eating lunch"
Current: "Should I be worried? What could it be?"
→ Complete description ending with clear questions

Example 7 - WAIT:
Recent: "I have diabetes"
Current: "And also"
→ "And also" indicates more information coming

Example 8 - RESPOND NOW:
"Hello"
→ Simple greeting deserves acknowledgment

Example 9 - WAIT:
Recent: "I'm 25 years old"
Current: "I have been experiencing"
→ In middle of building context

Example 10 - RESPOND NOW:
Recent: "I took the medication you suggested"
Current: "The symptoms have improved significantly, thank you!"
→ Clear update and conclusion

Example 11 - RESPOND NOW:
"[Image attached]"
→ User shared visual information, likely expects analysis/response

Example 12 - WAIT:
Recent: "I have a rash"
Current: "Let me send you"
→ User is about to send something (likely an image)

Example 13 - RESPOND NOW:
Recent: "Dime cual"
Current: "es tu nombre"
→ Direct question asking for name, requires immediate response

Example 14 - RESPOND NOW:
"what is your name?"
→ Direct question, clear intent

Example 15 - RESPOND NOW:
Recent: "Tell me about construction"
Current: "What materials should I use?"
→ Clear follow-up question

Example 16 - WAIT:
Empty message without image
→ Wait for actual content

Example 17 - RESPOND NOW:
Empty message with image
→ Visual information shared, likely expects response

TIMING CONSIDERATIONS:
- Look at timestamps to understand message flow and timing
- If messages are sent very quickly (within seconds), user might still be typing
- If there's a longer pause before the current message, it might be more complete
- Consider the natural flow of conversation timing

ANALYZE THIS CONVERSATION:
${conversationContext}

Consider:
- Does the current message end with connecting words like "and", "but", "also", "because"?
- Is there a clear question or request for advice?
- Does it feel like a complete thought or partial explanation?
- Are they still building context or providing background?
- Does the message flow suggest more is coming?
- What do the timestamps tell us about the user's messaging pattern?
- Is this an empty message? With or without an image?
- Does the timing suggest the user is still actively composing more messages?

Respond with your decision.`;

	try {
		const { object } = await generateObject({
			model: openai("gpt-4o-mini"),
			output: "enum",
			enum: ["respond_now", "wait_for_more"],
			prompt: prompt,
		});

		const shouldRespond = object === "respond_now";
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
