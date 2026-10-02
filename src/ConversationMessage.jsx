import React, {useId, useState} from 'react';
import {Play, Translate} from '@phosphor-icons/react';

export function cachedTranslation(message) {
  return message.translationSource === message.content && typeof message.translationZh === 'string'
    ? message.translationZh.trim() : '';
}

export function ConversationMessage({message, speaker, subtitles = true, onShowSubtitles, onSpeak, onTranslate, busy}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const translationId = useId();
  const translation = cachedTranslation(message);

  async function toggleTranslation() {
    if (open) { setOpen(false); return; }
    if (pending || busy) return;
    setPending(true);
    setError('');
    try {
      const text = await onTranslate();
      if (!text) throw new Error('翻译暂未完成，请重试。');
      setOpen(true);
    } catch (e) {
      setError(e.message || '翻译暂未完成，请重试。');
    } finally {
      setPending(false);
    }
  }

  return <div className={'turn ' + message.role}>
    <span className="turnLabel">{speaker}</span>
    {message.role === 'assistant' && !subtitles
      ? <button className="subtitleHidden" onClick={onShowSubtitles}>显示这一段文字</button>
      : <p lang="en">{message.content}</p>}
    <div className="turnActions">
      {message.role === 'assistant' && <button className="listenButton" onClick={()=>onSpeak(message.content)}><Play size={15}/>再听一遍</button>}
      <button className="translationButton" onClick={toggleTranslation}
        disabled={!open && (!!busy || pending)} aria-expanded={open} aria-controls={translationId}>
        <Translate size={16}/>{pending ? <span role="status">正在翻译…</span> : open ? '收起中文' : error ? '重试翻译' : '查看中文'}
      </button>
    </div>
    <div id={translationId} className="messageTranslation" hidden={!open} lang="zh-CN">
      <span>中文意思</span><p>{translation}</p>
    </div>
    {error && <p className="translationError" role="alert">{error}</p>}
  </div>;
}
