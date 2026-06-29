export default function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="bg-background-100 rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full bg-foreground-300 animate-typing-bounce"
            style={{ animationDelay: '0ms' }}
          ></span>
          <span
            className="w-2 h-2 rounded-full bg-foreground-300 animate-typing-bounce"
            style={{ animationDelay: '160ms' }}
          ></span>
          <span
            className="w-2 h-2 rounded-full bg-foreground-300 animate-typing-bounce"
            style={{ animationDelay: '320ms' }}
          ></span>
        </div>
      </div>
    </div>
  );
}