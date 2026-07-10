import Swal, { type SweetAlertIcon } from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

type CurriculumAlertOptions = {
  title: string;
  text?: string;
  icon?: SweetAlertIcon;
  timer?: number;
  confirmButtonText?: string;
};

type CurriculumLoadingOptions = {
  title: string;
  text?: string;
};

type CurriculumConfirmOptions = {
  title: string;
  text?: string;
  icon?: SweetAlertIcon;
  confirmButtonText: string;
  cancelButtonText?: string;
  successTitle?: string;
  successText?: string;
  onConfirm: () => void | Promise<void>;
};

const loadingPopupClass = 'kbc-standard-swal-loading';

export function showCurriculumAlert({
  title,
  text,
  icon = 'success',
  timer,
  confirmButtonText = 'OK',
}: CurriculumAlertOptions) {
  return Swal.fire({
    title,
    text,
    icon,
    width: 512,
    showConfirmButton: !timer,
    confirmButtonText,
    timer,
    timerProgressBar: Boolean(timer),
    buttonsStyling: false,
    customClass: {
      popup: 'kbc-standard-swal-popup',
      title: 'kbc-standard-swal-title',
      htmlContainer: 'kbc-standard-swal-text',
      actions: 'kbc-standard-swal-actions',
      confirmButton: 'kbc-standard-swal-confirm',
      timerProgressBar: 'kbc-standard-swal-progress',
    },
  });
}

export function showCurriculumLoading({ title, text }: CurriculumLoadingOptions) {
  return Swal.fire({
    title,
    text,
    icon: 'info',
    width: 512,
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    buttonsStyling: false,
    didOpen: () => Swal.showLoading(),
    customClass: {
      popup: `kbc-standard-swal-popup ${loadingPopupClass}`,
      title: 'kbc-standard-swal-title',
      htmlContainer: 'kbc-standard-swal-text',
      loader: 'kbc-standard-swal-loader',
    },
  });
}

export async function showCurriculumConfirm({
  title,
  text,
  icon = 'warning',
  confirmButtonText,
  cancelButtonText = 'Cancel',
  successTitle,
  successText,
  onConfirm,
}: CurriculumConfirmOptions) {
  const result = await Swal.fire({
    title,
    text,
    icon,
    width: 512,
    showCancelButton: true,
    showLoaderOnConfirm: true,
    reverseButtons: true,
    focusCancel: true,
    confirmButtonText,
    cancelButtonText,
    buttonsStyling: false,
    allowOutsideClick: () => !Swal.isLoading(),
    allowEscapeKey: () => !Swal.isLoading(),
    customClass: {
      popup: 'kbc-standard-swal-popup',
      title: 'kbc-standard-swal-title',
      htmlContainer: 'kbc-standard-swal-text',
      actions: 'kbc-standard-swal-actions',
      confirmButton: 'kbc-standard-swal-confirm',
      cancelButton: 'kbc-standard-swal-cancel',
      loader: 'kbc-standard-swal-loader',
      validationMessage: 'kbc-standard-swal-validation',
    },
    preConfirm: async () => {
      try {
        await onConfirm();
        return true;
      } catch (err) {
        Swal.showValidationMessage(err instanceof Error ? err.message : 'Unable to complete this action.');
        return false;
      }
    },
  });

  if (result.isConfirmed && successTitle) {
    await showCurriculumAlert({
      title: successTitle,
      text: successText,
      icon: 'success',
      timer: 1800,
      confirmButtonText: 'Done',
    });
  }

  return result.isConfirmed;
}

export function closeCurriculumLoading() {
  const popup = Swal.getPopup();
  if (popup?.classList.contains(loadingPopupClass)) Swal.close();
}
