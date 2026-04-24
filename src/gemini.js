import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

export const analyzePokemonCard = async (file) => {
  if (!apiKey || apiKey === "여기에_발급받은_Gemini_API_키를_붙여넣으세요") {
    throw new Error("Gemini API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.");
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);

  // 파일을 Base64 데이터로 변환 (Gemini API가 읽을 수 있는 형태)
  const reader = new FileReader();
  const filePromise = new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
  
  const base64Data = await filePromise;
  
  // 추가로 JSON 포맷을 강제(responseMimeType)하여 에러율을 0%로 줄임
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });
  
  const prompt = `
    당신은 세계 최고 수준의 포켓몬 카드 감정사이자 데이터베이스 전문가입니다.
    사용자가 제공한 포켓몬 카드 사진을 아주 세밀하게 분석해서, 도감 정리에 필요한 아래 정보를 추출해주세요.
    특히 카드 우측 하단이나 사이드의 아주 작은 마크(확장팩 기호)와 카드 번호(예: 349/190)를 주의 깊게 찾아보세요.
    
    아래 형태의 JSON 형식으로만 답변을 주어야 합니다.
    {
      "cardName": "포켓몬 한글 이름 (예: 리자돈 ex, 모야모, 네모)",
      "series": "해당 카드가 포함된 확장팩 이름 기호 (예: sv2a, s12a, sv4a 등 카드 하단의 작은 영어+숫자 조합) 모르면 빈칸",
      "cardNumber": "카드 하단에 적힌 번호 (예: 349/190 또는 006/165)",
      "rarity": "카드 레어도 기호 (예: SR, SAR, UR, AR, RR, C, U, R) 별모양은 AR/SAR 등이고, 글씨로 적혀있기도 합니다. 모르면 빈칸",
      "type": "카드의 큰 분류 (예: 포켓몬, 서포터, 아이템, 경기장, 에너지)",
      "pokedexNumber": "왼쪽이나 중앙의 도감 번호 숫자만 추출. (예: 006) 없으면 빈칸"
    }
    해당 이미지가 포켓몬 카드가 아니거나 정보를 찾을 수 없는 항목은 빈칸 "" 으로 두세요.
  `;
  
  const imagePart = {
    inlineData: {
      data: base64Data,
      mimeType: file.type
    }
  };

  try {
    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text();
    
    // JSON 모드를 켰으므로 안전하게 바로 파싱 가능
    return JSON.parse(responseText);
  } catch(e) {
    console.error("Gemini API Error:", e);
    throw new Error("에러 원인: " + (e.message || "알 수 없는 에러"));
  }
};
