import { redis } from "@/clients/redis";
import type { ConversationMessage } from "@/ai/generate-reponse";

const CONVERSATION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const MAX_MESSAGES = 10; // Maximum messages to keep for context

/**
 * Get the Redis key for a conversation
 */
function getConversationKey(phoneNumber: string): string {
	return `conversation:${phoneNumber}`;
}

/**
 * Store a message in the conversation history
 */
export async function storeMessage(
	phoneNumber: string,
	message: ConversationMessage
): Promise<void> {
	try {
		const key = getConversationKey(phoneNumber);
		
		// Add message to the list
		await redis.lpush(key, JSON.stringify(message));
		
		// Keep only the last MAX_MESSAGES messages
		await redis.ltrim(key, 0, MAX_MESSAGES - 1);
		
		// Set TTL to expire old conversations
		await redis.expire(key, CONVERSATION_TTL);
	} catch (error) {
		console.error("Error storing message:", error);
		// Don't throw - message storage shouldn't break the flow
	}
}

/**
 * Get conversation history for a phone number
 */
export async function getConversationHistory(
	phoneNumber: string
): Promise<ConversationMessage[]> {
	try {
		const key = getConversationKey(phoneNumber);
		
		// Get messages from Redis (they're stored in reverse order due to lpush)
		const messages = await redis.lrange(key, 0, MAX_MESSAGES - 1);
		
		if (!messages || messages.length === 0) {
			return [];
		}
		
		// Parse and reverse to get chronological order (oldest first)
		const parsedMessages: ConversationMessage[] = messages
			.map(msg => {
				try {
					// Handle both string and object cases
					if (typeof msg === 'string') {
						return JSON.parse(msg) as ConversationMessage;
					} else if (typeof msg === 'object' && msg !== null) {
						// If it's already an object, validate it has the right structure
						const objMsg = msg as any;
						if (objMsg.role && typeof objMsg.content === 'string' && objMsg.timestamp) {
							return objMsg as ConversationMessage;
						}
					}
					console.error("Invalid message format:", typeof msg, msg);
					return null;
				} catch (error) {
					console.error("Error parsing message:", error);
					return null;
				}
			})
			.filter((msg): msg is ConversationMessage => msg !== null)
			.reverse(); // Reverse to get chronological order
		
		return parsedMessages;
	} catch (error) {
		console.error("Error retrieving conversation history:", error);
		return []; // Return empty array on error
	}
}

