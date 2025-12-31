import { NextResponse } from "next/server";

type GeminiRequest = {
  action?: "summarize" | "improve" | "tags" | "generate" | "ask";
  content?: string;
  tone?: "casual" | "professional";
  prompt?: string;
  question?: string;
  notesContext?: string;
};

const buildPrompt = (payload: GeminiRequest) => {
  const content = payload.content?.trim() ?? "";
  const tone = payload.tone ?? "professional";

  switch (payload.action) {
    case "summarize":
      return `Summarize this note in 3 concise bullet points. No extra commentary:\n\n${content}`;
    case "improve":
      return `Rewrite this note to improve clarity and structure. Use a ${tone} tone. Return ONLY a single rewritten version (no headings, no bullet points, no multiple options). Keep it concise (max 2 short paragraphs) and preserve the original meaning:\n\n${content}`;
    case "tags":
      return `Suggest 5 short tags for this note. Respond as a comma-separated list without hashtags:\n\n${content}`;
    case "generate":
      return `Write a concise draft note based on the following topic. Return ONLY the draft (no headings, no options):\n\n${payload.prompt ?? ""}`;
    case "ask":
      return `You are an assistant with access to the user's notes. Use the notes to answer the question.\nIf there are relevant notes, list them with their titles and a short reason. If not, say you could not find a relevant note.\n\nNotes:\n${payload.notesContext ?? ""}\n\nQuestion: ${payload.question ?? ""}`;
    default:
      return content;
  }
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeminiRequest;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY." },
        { status: 500 }
      );
    }

    if (body.action === "ask") {
      if (!body.question?.trim()) {
        return NextResponse.json(
          { error: "Missing question." },
          { status: 400 }
        );
      }
      if (!body.notesContext?.trim()) {
        return NextResponse.json(
          { error: "Missing notes context." },
          { status: 400 }
        );
      }
    }

    const prompt = buildPrompt(body);
    if (!prompt) {
      return NextResponse.json({ error: "Empty prompt." }, { status: 400 });
    }

    const preferredModel = process.env.GEMINI_MODEL ?? "gemini-1.5-flash-latest";
    const fallbackModels = process.env.GEMINI_MODEL
      ? [preferredModel]
      : [preferredModel, "gemini-1.5-pro", "gemini-1.0-pro"];

    const requestModel = (model: string) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.6,
              topP: 0.9,
              maxOutputTokens: 1024,
            },
          }),
        }
      );

    let response = await requestModel(fallbackModels[0]);
    let modelIndex = 0;

    while (!response.ok && response.status === 404 && modelIndex < fallbackModels.length - 1) {
      modelIndex += 1;
      response = await requestModel(fallbackModels[modelIndex]);
    }

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: text || "Gemini request failed." },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "No content returned." },
        { status: 500 }
      );
    }

    if (body.action === "tags") {
      const tags = text
        .split(/[,\\n]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean);
      return NextResponse.json({ text, tags });
    }

    return NextResponse.json({ text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gemini request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
