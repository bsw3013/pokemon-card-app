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

/**
 * 매물 사진 URL을 분석해서 실제로 어떤 카드가 찍혀있는지, 여러 장(묶음)인지 판단한다.
 * 번개장터/당근마켓 등 CDN이 CORS를 막아둔 경우 이미지를 직접 불러올 수 없어 실패할 수 있다.
 */
export const analyzeListingImage = async (imageUrl, expectedCardName) => {
  if (!apiKey || apiKey === "여기에_발급받은_Gemini_API_키를_붙여넣으세요") {
    throw new Error("Gemini API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.");
  }

  let base64Data;
  let mimeType;
  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error(`이미지를 불러오지 못했습니다 (${imgResp.status})`);
    const blob = await imgResp.blob();
    mimeType = blob.type || 'image/jpeg';
    base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    throw new Error('이 사이트의 이미지는 브라우저에서 직접 불러올 수 없어 사진분석이 불가합니다. (' + (e.message || 'CORS 차단') + ')');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `
    당신은 포켓몬 카드 중고거래 사진을 감정하는 전문가입니다.
    이 사진을 보고 아래 JSON 형식으로만 답변하세요.
    {
      "cardCount": 사진에 보이는 개별 카드 장수(숫자, 여러 장이면 묶음판매일 가능성이 큼),
      "cardName": "가장 크게/명확하게 보이는 카드의 포켓몬 한글 이름 (모르면 빈칸)",
      "matchesExpected": ${JSON.stringify(expectedCardName || '')} 이름과 사진 속 카드가 같은 카드인지 (true/false),
      "confidence": 0~100 사이 확신도 숫자,
      "note": "판단 근거를 한 문장으로"
    }
  `;

  const imagePart = { inlineData: { data: base64Data, mimeType } };

  try {
    const result = await model.generateContent([prompt, imagePart]);
    return JSON.parse(result.response.text());
  } catch (e) {
    console.error('Gemini 사진분석 오류:', e);
    throw new Error('사진 분석 실패: ' + (e.message || '알 수 없는 에러'));
  }
};
