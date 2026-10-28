import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Sparkles, BookOpen, UserCircle2, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const STORAGE_KEY = 'studybuddy_chat_messages_v1';

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'model',
  content: "Hey there! 👋 I'm here to hang out as a friend or help you study like a pro. What's on your mind today? We can chat, or we can dive into some homework!",
};

// Define message type
type Message = {
  id: string;
  role: 'user' | 'model';
  content: string;
};

const loadInitialMessages = (): Message[] => {
  if (typeof window === 'undefined') return [DEFAULT_WELCOME_MESSAGE];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validMessages = parsed.filter(
          (m: unknown): m is Message =>
            typeof m === 'object' &&
            m !== null &&
            'id' in m &&
            'role' in m &&
            'content' in m &&
            typeof (m as Message).content === 'string' &&
            (m as Message).content.trim().length > 0
        );
        if (validMessages.length > 0) {
          return validMessages;
        }
      }
    }
  } catch (error) {
    console.error('Error reading chat history from localStorage:', error);
  }
  return [DEFAULT_WELCOME_MESSAGE];
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>(loadInitialMessages);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Synchronize message history with localStorage
  useEffect(() => {
    try {
      const toSave = messages.filter((m) => m.content.trim().length > 0);
      if (toSave.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      }
    } catch (error) {
      console.error('Error saving chat history to localStorage:', error);
    }
  }, [messages]);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleClearHistory = () => {
    if (isStreaming) return;
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing chat history from localStorage:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isStreaming) return;

    const userText = inputText.trim();
    setInputText('');

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
    };

    const incomingMessageId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      newUserMessage,
      { id: incomingMessageId, role: 'model', content: '' },
    ]);
    setIsStreaming(true);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, newUserMessage].map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No readable stream available');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullResponse = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataContent = trimmed.slice(5).trim();
          if (dataContent === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataContent);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.text) {
              fullResponse += parsed.text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === incomingMessageId
                    ? { ...msg, content: fullResponse }
                    : msg
                )
              );
            }
          } catch (e: any) {
            if (e.message && e.message !== dataContent) {
              console.error('Error parsing SSE event:', e);
            }
          }
        }
      }

      if (!fullResponse.trim()) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === incomingMessageId
              ? { ...msg, content: "I'm here! What would you like to explore next?" }
              : msg
          )
        );
      }
    } catch (error) {
      console.warn('Streaming error, trying /api/chat fallback:', error);
      try {
        const fallbackRes = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [...messages, newUserMessage].map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
          }),
        });

        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          if (data.text) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === incomingMessageId
                  ? { ...msg, content: data.text }
                  : msg
              )
            );
            return;
          }
        }
      } catch (fallbackErr) {
        console.error('Fallback /api/chat error:', fallbackErr);
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === incomingMessageId
            ? { ...msg, content: "Oops! I hit a snag trying to reply. Can we try that again?" }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  // Handle Ctrl+Enter to send
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#F5F5F0] font-sans text-[#4A4A40]">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 bg-[#FDFDFB] border-b border-[#D8D8CF] shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#5A5A40] text-[#FDFDFB] flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#4A4A40]">StudyBuddy</h1>
            <p className="text-xs font-medium text-[#4A4A40]/60 flex items-center gap-1.5 font-serif italic">
              <span className="w-2 h-2 rounded-full bg-[#5A5A40]"></span>
              Always here for you
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[#4A4A40]/60">
          <button
            onClick={handleClearHistory}
            disabled={isStreaming}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#D8D8CF] hover:border-[#5A5A40] hover:text-[#5A5A40] text-xs font-medium bg-[#F5F5F0]/60 hover:bg-[#F5F5F0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            title="Start a new chat (clears saved history)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
          <div className="h-4 w-[1px] bg-[#D8D8CF] mx-1"></div>
          <button className="hover:text-[#5A5A40] transition-colors p-1" title="Friend Mode Active">
            <UserCircle2 className="w-5 h-5" />
          </button>
          <button className="hover:text-[#5A5A40] transition-colors p-1" title="Study Mode Ready">
            <BookOpen className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {messages.map((message) => {
            const isUser = message.role === 'user';
            
            return (
              <div
                key={message.id}
                className={isUser ? "flex justify-end" : "flex justify-start"}
              >
                <div className={"flex gap-4 max-w-[85%] sm:max-w-[75%] " + (isUser ? "flex-row-reverse" : "flex-row")}>
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    <div className={"w-10 h-10 flex items-center justify-center rounded-full mt-1 shrink-0 " + 
                      (isUser ? "bg-[#5A5A40] text-white" : "bg-[#E8E8DF] text-[#4A4A40]")
                    }>
                      {isUser ? <span className="font-semibold text-sm">U</span> : <span className="text-xl">🌿</span>}
                    </div>
                  </div>

                  {/* Message Bubble */}
                  <div className={"px-5 py-5 rounded-[24px] text-[15px] leading-relaxed " + 
                    (isUser 
                      ? "bg-[#5A5A40] text-white border-none" 
                      : "bg-[#FFFFFF] border border-[#E5E5DB] text-[#4A4A40] shadow-[0_4px_12px_rgba(0,0,0,0.03)]")
                  }>
                    {isUser ? (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    ) : (
                      <div className="markdown-body text-inherit">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                        {isStreaming && message.id === messages[messages.length - 1].id && (
                          <span className="inline-block w-1.5 h-4 ml-1 bg-[#5A5A40] animate-pulse align-middle"></span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="shrink-0 bg-[#FDFDFB] border-t border-[#D8D8CF] p-4 sm:p-8">
        <div className="max-w-4xl mx-auto relative">
          <textarea
            className="w-full bg-[#F5F5F0] rounded-2xl border border-[#E5E5DB] focus:ring-0 outline-none resize-none max-h-48 py-5 pl-5 pr-24 text-[15px] text-[#4A4A40] placeholder-[#4A4A40]/50 italic leading-relaxed"
            rows={1}
            placeholder="Type your answer here..."
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              // Auto-resize
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleSubmit}
            disabled={!inputText.trim() || isStreaming}
            className="absolute right-3 bottom-3 bg-[#5A5A40] hover:bg-[#4A4A35] disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm active:scale-95 flex items-center justify-center"
          >
            Send
          </button>
        </div>
        <div className="text-center mt-4">
          <p className="text-xs text-[#4A4A40]/50 font-serif italic">
            StudyBuddy can make mistakes. Consider verifying important information.
          </p>
        </div>
      </footer>
    </div>
  );
}

