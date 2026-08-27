/** Centered, navigation-free frame for the sign-in page. */
export default function BareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}
