import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import type { ConversationMessage } from "./generate-reponse";

export async function shouldRespondNow(
	currentMessage: string,
	conversationHistory: ConversationMessage[] = [],
	hasImage: boolean = false
): Promise<boolean> {
	// Handle special cases first
	if (!currentMessage.trim() && hasImage) {
		// Image-only message - usually means user is sharing visual information
		// and likely expects a response
		return true;
	}
	
	if (!currentMessage.trim() && !hasImage) {
		// Empty message without image - wait for more content
		return false;
	}

	// Check for direct questions that should always get immediate responses
	const directQuestionPatterns = [
		/\?$/, // Ends with question mark
		/^(what|who|when|where|why|how|cual|quien|cuando|donde|por que|como|que es)/i, // Question words
		/^(es tu|cual es|que|dime|tell me|what is|who is)/i, // Direct inquiry patterns
		/nombre\?/i, // Asking about name
		/^(si|yes|no)\s*\?/i, // Yes/no questions
	];
	
	if (directQuestionPatterns.some(pattern => pattern.test(currentMessage.trim()))) {
		console.log("Direct question pattern detected, responding immediately");
		return true;
	}

	// Additional check for very short messages that are clearly questions
	const trimmedMessage = currentMessage.trim().toLowerCase();
	if (trimmedMessage.length < 20 && (
		trimmedMessage.includes('?') || 
		trimmedMessage.startsWith('es ') ||
		trimmedMessage.startsWith('que ') ||
		trimmedMessage.startsWith('como ')
	)) {
		console.log("Short direct question detected, responding immediately");
		return true;
	}

	// Get recent messages (last 10 messages or last 5 minutes)
	const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
	const recentMessages = conversationHistory
		.filter(msg => msg.timestamp > fiveMinutesAgo)
		.slice(-10);

	// Format conversation context for analysis
	let conversationContext = "";
	if (recentMessages.length > 0) {
		conversationContext = "Recent conversation:\n" + 
			recentMessages
				.map(msg => `${msg.role}: ${msg.content}`)
				.join("\n") + "\n";
	}
	
	const messageDescription = hasImage && !currentMessage.trim() 
		? "[Image sent without caption]" 
		: currentMessage;
	
	conversationContext += `Current message: ${messageDescription}`;

	const prompt = `You are analyzing a WhatsApp conversation to decide if an AI assistant should respond now or wait for more messages.

CONTEXT: Users often send their medical/health consultations in multiple short messages instead of one long message. We want to avoid responding too early before they finish explaining their complete situation.

DECISION CRITERIA:
- RESPOND NOW if:
  * Message asks a direct question (ends with ?, starts with question words)
  * Message seems complete and coherent
  * User indicates they're done explaining
  * Simple greetings or acknowledgments
  * Questions about identity, names, or basic info

- WAIT if:
  * Message seems incomplete or cut off
  * Ends with connecting words ("and", "also", "because", "but")
  * User is clearly building up to something
  * Message is very brief without clear intent (unless it's a complete question)

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
"[Image sent without caption]"
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

ANALYZE THIS CONVERSATION:
${conversationContext}

Consider:
- Does the current message end with connecting words like "and", "but", "also", "because"?
- Is there a clear question or request for advice?
- Does it feel like a complete thought or partial explanation?
- Are they still building context or providing background?
- Does the message flow suggest more is coming?

Respond with your decision.`;

	try {
		const { object } = await generateObject({
			model: openai('gpt-4o-mini'),
			output: 'enum',
			enum: ['respond_now', 'wait_for_more'],
			prompt: prompt,
		});

		const shouldRespond = object === 'respond_now';
		console.log(`AI Decision: ${object} for message: "${currentMessage}" (hasImage: ${hasImage})`);
		
		return shouldRespond;
	} catch (error) {
		console.error('Error in shouldRespondNow:', error);
		// Default to responding if AI decision fails
		return true;
	}
} 