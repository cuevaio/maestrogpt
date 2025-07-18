// Function to download media from WhatsApp
export async function downloadWhatsAppMedia(
	mediaId: string,
): Promise<string | null> {
	try {
		// First, get the media URL
		const mediaResponse = await fetch(
			`https://graph.facebook.com/v22.0/${mediaId}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
				Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
