export function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`缺少页面元素：${selector}`);
  return found;
}

export function byId<T extends HTMLElement>(id: string): T {
  return element<T>(`#${id}`);
}
