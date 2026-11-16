export function withDiscriminant<T extends { discriminant?: string }>(value: T, discriminant: string | undefined): T {
  if (discriminant !== undefined) {
    value.discriminant = discriminant;
  }
  return value;
}

export function formatVariantName(name: string, discriminant: string | undefined): string {
  return discriminant === undefined ? name : `${name} = ${discriminant}`;
}
