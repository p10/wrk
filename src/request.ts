type Params = Parameters<typeof fetch>;
export async function request(url: Params[0], opts: Params[1]): Promise<string> {
  const res = await fetch(url, opts).catch((err) => {
    throw new Error(`Fetch error`, { cause: err });
  });
  if (!res.ok) {
    throw new Error(`Fetch request error: ${res.status}, ${res.statusText}`);
  }
  return res.text();
}