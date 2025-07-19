import { generateResponse } from "@/ai/generate-reponse";

const response = await generateResponse(
  "Cuanto debe medir, como minimo, una zapata para una vivienda de 3 pisos?",
  [],
);

console.log(response);
