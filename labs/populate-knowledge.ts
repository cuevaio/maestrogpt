import { mistral } from "@/clients/mistral";
import { vector } from "@/clients/vector";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const resp = await mistral.ocr.process({
	model: "mistral-ocr-latest",
	document: {
		type: "document_url",
		documentUrl:
			"https://ww3.vivienda.gob.pe/ejes/vivienda-y-urbanismo/documentos/Reglamento%20Nacional%20de%20Edificaciones.pdf",
	},
	includeImageBase64: false,
});

const chunks: {
	content: string;
	pageIndex: number;
	chunkIndex: number;
}[] = [];

for (const [pageIndex, page] of resp.pages.entries()) {
	const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
		chunkSize: 1024,
		chunkOverlap: 128,
	});
	const output = await splitter.splitText(page.markdown);

	chunks.push(
		...output.map((chunk, chunkIndex) => ({
			content: chunk,
			pageIndex,
			chunkIndex,
		})),
	);
}

// Split chunks into groups of 100 and upsert in batches
const BATCH_SIZE = 300;

for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
	const batch = chunks.slice(i, i + BATCH_SIZE);
	await vector.upsert(
		batch.map((chunk) => ({
			id: `${chunk.pageIndex}-${chunk.chunkIndex}`,
			data: chunk.content,
			metadata: {
				pageIndex: chunk.pageIndex,
				chunkIndex: chunk.chunkIndex,
			},
		})),
	);
	console.log(`Upserted batch ${i / BATCH_SIZE + 1} (${batch.length} chunks)`);
}

console.log("Processed", resp.pages.length, "pages");
console.log("Processed", chunks.length, "chunks");
