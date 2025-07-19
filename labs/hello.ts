import { generateResponse } from "@/ai/generate-reponse";

const response = await generateResponse(
  [
    {
      role: "user",
      content: "Cuanto debe medir, como minimo, una zapata para una vivienda de 3 pisos?",
      timestamp: Date.now(),
    },
  ],
);

console.log(response);
