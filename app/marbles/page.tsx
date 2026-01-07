import type { Metadata } from 'next';

import { MarblesPrototype } from './marbles-prototype';

export const metadata: Metadata = {
  title: '구슬 레이스',
  description: '구슬 레이스예요.',
};

export default function MarblesPage() {
  return <MarblesPrototype />;
}
