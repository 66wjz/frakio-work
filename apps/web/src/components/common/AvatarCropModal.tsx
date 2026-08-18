// wjz新建文件，新建原因：解耦通用头像裁剪模态框组件（AvatarCropModal），修改时间：2026-08-17。
// 文件内容概述：支持图片缩放、拖拽平移、边缘贴靠以及 512x512 PNG Canvas 裁剪导出。
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export function AvatarCropModal({
  file,
  title,
  saving,
  onCancel,
  onSave,
}: {
  file: File;
  title: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function imageMetrics() {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image || !frame) return null;
    const size = frame.clientWidth || 280;
    const naturalWidth = image.naturalWidth || 1;
    const naturalHeight = image.naturalHeight || 1;
    const baseScale = Math.max(size / naturalWidth, size / naturalHeight);
    const drawWidth = naturalWidth * baseScale * scale;
    const drawHeight = naturalHeight * baseScale * scale;
    return { size, drawWidth, drawHeight };
  }

  function clampOffset(next: { x: number; y: number }) {
    const metrics = imageMetrics();
    if (!metrics) return next;
    const maxX = Math.max(0, (metrics.drawWidth - metrics.size) / 2);
    const maxY = Math.max(0, (metrics.drawHeight - metrics.size) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function saveCroppedAvatar() {
    const image = imageRef.current;
    const metrics = imageMetrics();
    if (!image || !metrics) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = 512 / metrics.size;
    const drawWidth = metrics.drawWidth * ratio;
    const drawHeight = metrics.drawHeight * ratio;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(
      image,
      (512 - drawWidth) / 2 + offset.x * ratio,
      (512 - drawHeight) / 2 + offset.y * ratio,
      drawWidth,
      drawHeight,
    );
    onSave(canvas.toDataURL('image/png'));
  }

  return (
    <div className="modal-backdrop nested" onClick={onCancel}>
      <div
        className="modal avatar-crop-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>拖动位置，放大后保存为圆形安全区。</p>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="avatar-crop-body">
          <div
            className="avatar-crop-frame"
            ref={frameRef}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragStart({
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                offsetX: offset.x,
                offsetY: offset.y,
              });
            }}
            onPointerMove={(event) => {
              if (!dragStart || dragStart.pointerId !== event.pointerId) return;
              setOffset(
                clampOffset({
                  x: dragStart.offsetX + event.clientX - dragStart.x,
                  y: dragStart.offsetY + event.clientY - dragStart.y,
                }),
              );
            }}
            onPointerUp={() => setDragStart(null)}
            onPointerCancel={() => setDragStart(null)}
          >
            {imageUrl && (
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }}
                onLoad={() => setOffset((current) => clampOffset(current))}
                draggable={false}
              />
            )}
          </div>
          <label className="avatar-crop-slider">
            <span>缩放</span>
            <input
              type="range"
              min="1"
              max="2.6"
              step="0.01"
              value={scale}
              onChange={(event) => {
                setScale(Number(event.target.value));
                window.requestAnimationFrame(() =>
                  setOffset((current) => clampOffset(current)),
                );
              }}
            />
          </label>
        </div>
        <div className="avatar-crop-footer">
          <button className="secondary-btn" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button
            className="send-btn"
            onClick={saveCroppedAvatar}
            disabled={saving}
          >
            {saving ? '保存中' : '保存头像'}
          </button>
        </div>
      </div>
    </div>
  );
}
// wjz新建文件结束。
