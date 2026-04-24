export const defaultConfig = {
  seriesOptions: [
    "XY 확장팩 제1탄 「X컬렉션」", "XY 확장팩 제1탄 「Y컬렉션」", "XY BREAK 확장팩 BASE PACK 20th Anniversary",
    "sm6a -「드래곤스톰」", "sm6b -「챔피언로드」", "sm8b -「울트라샤이니」", "sm9b", "sm10", "sm10b -「스카이레전드」", "sm11", "sm11a -「리믹스바우트」", "sm11b -「드림리그」", "sm12a -「TAG TEAM GX 태그올스타즈」",
    "s6a -「이브이 히어로즈」", "s7R -「창공스트림」", "s8a-P -「25주년 프로모팩」", "s8b -「VMAX 클라이맥스」", "s9 -「스타버스」", "s9a -「배틀리전」", "s10P -「스페이스 저글러」", "s10a -「다크판타스마」", "s11 -「로스트어비스」", "s11a -「백열의 아르카나」", "s12a -「VSTAR 유니버스」",
    "sv1S -「스칼렛 ex」", "sv1V -「바이올렛 ex」", "sv1a -「트리플렛비트」", "sv2a -「포켓몬 카드 151」", "sv2D -「클레이버스트」", "sv2P -「스노해저드」", "sv3 - 「흑염의 지배자」", "sv3a -「레이징서프」", "sv4K -「고대의 포효」", "sv4M -「미래의 일섬」", "sv4a -「샤이니트레저 ex」", "sv5K -「와일드포스」", "sv5M -「사이버저지」", "sv5a -「크림슨헤이즈」", "sv6 -「변환의 가면」", "sv6a -「나이트원더러」", "sv7 -「스텔라미라클」", "sv7a -「낙원드래고나」", "sv8 -「초전브레이커」", "sv8a -「테라스탈 페스타 ex」", "sv9 -「배틀파트너즈」", "sv9a -「열풍의 아레나」", "sv10 -「로켓단의 영광」", "svOD -「성호의 메탕&메타그로스 ex」", "svOM -「마리의 모르페코&오롱털 ex」", "sv11B -「블랙볼트」", "sv11W -「화이트플레어」",
    "m1L -「메가 브레이브」", "m1S -「메가 심포니아」", "m2 -「인페르노X」", "m2a -「메가드림」", "MC - MEGA「스타트 덱 100 배틀컬렉션」",
    "PROMO"
  ],
  rarityOptions: ["C", "U", "R", "RR", "RRR", "S", "SR", "SSR", "HR", "UR", "AR", "SAR", "CHR", "CSR", "A", "MA", "BWR", "MUR", "PROMO", "기타 AR", "없음"],
  gradingCompaniesOptions: ["PSA", "Beckett", "CGC", "KSC"],
  gradingScaleOptions: ["1","2","3","4","5","6","7","8","9","10"],
  typeOptions: ["포켓몬", "서포트", "도구", "스타디움", "에너지"],
  statusOptions: ["S급 (민트)", "A급 (니어민트)", "B급 (우수)", "C급 (플레이용)", "손상됨", "상태 없음"],
  displayFields: [
    { id: 'cardName', label: '고유 이름', visible: true, order: 1 },
    { id: 'pokedexNumber', label: '전국 도감 번호', visible: true, order: 2 },
    { id: 'series', label: '확장팩/시리즈', visible: true, order: 3 },
    { id: 'cardNumber', label: '카드 단일 넘버', visible: true, order: 4 },
    { id: 'rarity', label: '레어도 (Rarity)', visible: true, order: 5 },
    { id: 'type', label: '종류', visible: true, order: 6 },
    { id: 'status', label: '보유 정보', visible: true, order: 7 },
    { id: 'price', label: '현재 평가 가격 (₩)', visible: true, order: 8 }
  ]
};
