import { useState } from 'preact/hooks';

export default function LocalInteraction() {
  const [count, setCount] = useState(0);
  return (
    <section aria-label="Local interaction">
      <s-button onClick={() => setCount((value) => value + 1)}>Count locally</s-button>
      <output aria-live="polite">Local count: {count}</output>
    </section>
  );
}
