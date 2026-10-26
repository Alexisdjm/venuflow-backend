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
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
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
    });
    if (!response.ok) throw new BadGatewayException(failure);
  }
}
