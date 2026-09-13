import { Dialog } from '@nutui/nutui';
import { createVNode } from 'vue';

interface DeleteDialogOptions {
  title: string;
  content: string;
  cancelText: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
}

export const openDeleteDialog = ({
  title,
  content,
  cancelText,
  confirmText,
  onConfirm,
}: DeleteDialogOptions) => {
  Dialog({
    title,
    content: createVNode('span', { style: 'white-space: pre-line;' }, content),
    onOk: onConfirm,
    popClass: 'auto-dialog',
    cancelText,
    okText: confirmText,
    closeOnPopstate: true,
    lockScroll: false,
  });
};
