import type { Metadata } from 'next';

import { MarblesPrototype } from './marbles-prototype';

export const metadata: Metadata = {
  title: '구슬 레이스',
  description: '1,000명 구슬 레이스 방송용 프로토타입이에요.',
};

export default function MarblesPage() {
  return <MarblesPrototype />;
}
