'use client';

import { useEffect, useState } from 'react';

export function Stock() {
  const [stock, setStock] = useState<string>('loading…');
  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((d) => {
        setStock(`checked in ${d.waitedMs} ms`);
        (window as unknown as { __done?: boolean }).__done = true;
      });
  }, []);
  return <p id="stock">Stock: {stock}</p>;
}
