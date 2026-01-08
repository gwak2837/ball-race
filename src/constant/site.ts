export const SITE_NAME = '구슬 레이스'

export const SITE_DESCRIPTION = '최대 1,000명이 달리는 구슬 레이스예요. 참가자를 설정하고 바로 시작해 보세요.'

export const SITE_TITLE_TEMPLATE = `%s | ${SITE_NAME}`

export const SITE_KEYWORDS = [
  '구슬 레이스',
  '마블 레이스',
  'Raceball',
  '레이스 게임',
  '시뮬레이션 게임',
  '브라우저 게임',
  'marble race',
]

export const SOCIAL_IMAGE = {
  title: SITE_NAME,
  subtitle: SITE_DESCRIPTION,
  brand: 'Raceball',
  alt: `${SITE_NAME} - Raceball`,
  size: {
    width: 1200,
    height: 630,
  },
  ogPath: '/opengraph-image',
  twitterPath: '/twitter-image',
} as const
