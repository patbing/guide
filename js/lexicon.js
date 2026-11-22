// lexicon.js — 한국 브랜드/카테고리/관계 사전. 필요할 때 계속 추가.
export const BRANDS = {
  gs25: ['gs25', '지에스25', '지에스', 'gs25편의점'],
  cu: ['cu', '씨유', 'cu편의점'],
  seven: ['세븐일레븐', '세븐', '7-eleven', '7eleven'],
  emart24: ['이마트24', 'emart24'],
  starbucks: ['스타벅스', '스벅'],
  mega: ['메가커피', '메가mgc', '메가mgc커피', '메가'],
  compose: ['컴포즈커피', '컴포즈'],
  paris: ['파리바게뜨', '파바'],
  tlju: ['뚜레쥬르', '뚜레'],
  oliveyoung: ['올리브영'],
  daiso: ['다이소'],
  bank: ['은행', '국민은행', '신한은행', '우리은행', '하나은행', '농협', '기업은행', '카카오뱅크', '토스뱅크'],
  pharmacy: ['약국', '약방'],
  convenience: ['편의점'],
  cafe: ['카페', '커피', '커피숍', 'coffee'],
  subway: ['지하철역', '역', '출구'],
};

export const CATEGORY_ALIASES = {
  convenience: ['편의점'],
  cafe: ['카페', '커피', '커피숍'],
  bank: ['은행', 'atm'],
  pharmacy: ['약국', '약방'],
  restaurant: ['식당', '음식점', '밥집'],
  bakery: ['빵집', '베이커리'],
  beauty: ['미용실', '헤어', '네일', '뷰티'],
  subway_exit: ['출구', '지하철역', '역'],
  building: ['빌딩', '건물'],
};

export const RELATIONS = {
  '앞': 'ahead', '앞에': 'ahead', '정면': 'ahead', '전방': 'ahead',
  '뒤': 'behind', '뒤에': 'behind', '뒷쪽': 'behind',
  '왼쪽': 'left', '왼편': 'left', '좌측': 'left',
  '오른쪽': 'right', '오른편': 'right', '우측': 'right',
  '건너편': 'across', '맞은편': 'across', '반대편': 'across',
  '옆': 'beside', '옆에': 'beside',
};

export const TURN_WORD = { L: '좌회전', R: '우회전', S: '직진', C: '횡단' };

export function normalize(text) {
  return String(text || '').toLowerCase().replace(/[\s\-_.,!?~·'"()[\]]/g, '');
}

/** 텍스트에서 가장 긴 브랜드 별칭을 찾아 canonical brand 반환 */
export function detectBrand(text) {
  const n = normalize(text);
  let best = null;
  for (const [canonical, aliases] of Object.entries(BRANDS)) {
    for (const alias of aliases) {
      const a = normalize(alias);
      if (n.includes(a) && (!best || a.length > best.len)) best = { canonical, len: a.length };
    }
  }
  return best?.canonical || null;
}

export function detectCategory(text) {
  const n = normalize(text);
  let best = null;
  for (const [canonical, aliases] of Object.entries(CATEGORY_ALIASES)) {
    for (const alias of aliases) {
      const a = normalize(alias);
      if (n.includes(a) && (!best || a.length > best.len)) best = { canonical, len: a.length };
    }
  }
  return best?.canonical || null;
}

export function detectRelation(text) {
  const n = normalize(text);
  let best = null;
  for (const [alias, rel] of Object.entries(RELATIONS)) {
    const a = normalize(alias);
    if (n.includes(a) && (!best || a.length > best.len)) best = { rel, len: a.length };
  }
  return best?.rel || null;
}
