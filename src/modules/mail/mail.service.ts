import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderMailTemplate } from './templates/render-mail-template';

export type BookingMail = {
  to: string;
  customerName: string;
  spaName: string;
  serviceName: string;
  professionalName: string;
  when: string;
  expiresAt?: string;
  verificationUrl?: string;
  reference?: string;
  previousWhen?: string;
  deposit?: string;
};

@Injectable()
export class MailService {
  constructor(private readonly config: ConfigService) {}

  sendBookingVerification(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'Confirma tu reserva en VenueFlow',
      'No se pudo enviar el correo de verificación',
      renderMailTemplate('booking-verification.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        when: message.when,
        expiresAt: message.expiresAt ?? '',
        verificationUrl: message.verificationUrl ?? '',
      }),
    );
  }

  sendBookingUpdate(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'Tu cita en VenueFlow fue actualizada',
      'No se pudo enviar el correo de actualización',
      renderMailTemplate('booking-update.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        previousWhen: message.previousWhen ?? '',
        when: message.when,
        reference: message.reference ?? 'Revisa el nuevo horario.',
        verificationUrl: message.verificationUrl ?? '',
      }),
    );
  }

  sendBookingPaymentReceived(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'Recibimos tu pago en VenueFlow',
      'No se pudo enviar el acuse del pago',
      renderMailTemplate('booking-payment-received.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        when: message.when,
        deposit: message.deposit ?? '',
        reference: message.reference ?? '',
        expiresAt: message.expiresAt ?? '',
      }),
    );
  }

  sendBookingConfirmed(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'Tu reserva en VenueFlow está confirmada',
      'No se pudo enviar el correo de confirmación',
      renderMailTemplate('booking-confirmed.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        when: message.when,
        reference: message.reference ?? '',
        verificationUrl: message.verificationUrl ?? '',
      }),
    );
  }

  sendBookingPaymentExpired(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'Tu horario en VenueFlow quedó libre',
      'No se pudo enviar el aviso de vencimiento',
      renderMailTemplate('booking-payment-expired.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        when: message.when,
        reference: message.reference ?? 'El tiempo de revisión terminó y el horario quedó libre.',
      }),
    );
  }

  sendBookingPaymentRejected(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'No pudimos validar tu pago en VenueFlow',
      'No se pudo enviar el correo de rechazo',
      renderMailTemplate('booking-payment-rejected.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        when: message.when,
        reference: message.reference ?? 'No pudimos validar el pago.',
      }),
    );
  }

  sendBookingCancellation(message: BookingMail) {
    return this.send(
      message.to,
      message.customerName,
      'Tu reserva en VenueFlow fue cancelada',
      'No se pudo enviar el correo de cancelación',
      renderMailTemplate('booking-cancellation.html', {
        customerName: message.customerName,
        spaName: message.spaName,
        serviceName: message.serviceName,
        professionalName: message.professionalName,
        when: message.when,
        reference: message.reference ?? 'La cita quedó cancelada.',
      }),
    );
  }

  private async send(
    to: string,
    name: string,
    subject: string,
    failure: string,
    htmlContent: string,
  ) {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL');
    const senderName = this.config.get<string>('BREVO_SENDER_NAME') ?? 'VenueFlow';
    if (!apiKey || !senderEmail) {
      throw new ServiceUnavailableException('El envío de correo no está configurado');
    }
    let response: Response;
    try {
      response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName },
          to: [{ email: to, name }],
          subject,
          htmlContent,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException(failure);
    }
    if (!response.ok) throw new BadGatewayException(failure);
  }
}
