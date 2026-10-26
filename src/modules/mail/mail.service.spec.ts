import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  const message = {
    to: 'ana@example.com',
    customerName: 'Ana <Pérez>',
    spaName: 'Emi Nails',
    serviceName: 'Manos Sencillas',
    professionalName: 'Según disponibilidad',
    when: 'martes, 27 oct 2026, 10:00 a. m.',
    expiresAt: 'martes, 27 oct 2026, 10:15 a. m.',
    verificationUrl: 'https://reservas.example/booking/verify?token=abc',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the VenueFlow verification template with the appointment details', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messageId: 'brevo-1' }), { status: 201 }));
    const service = new MailService(config());

    await service.sendBookingVerification(message);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      sender: { name: string };
      subject: string;
      htmlContent: string;
    };
    expect(body.sender.name).toBe('VenueFlow');
    expect(body.subject).toBe('Confirma tu reserva en VenueFlow');
    expect(body.htmlContent).toContain('VenueFlow');
    expect(body.htmlContent).toContain('Manos Sencillas');
    expect(body.htmlContent).toContain('Emi Nails');
    expect(body.htmlContent).toContain('Ana &lt;Pérez&gt;');
    expect(body.htmlContent).toContain('https://reservas.example/booking/verify?token=abc');
  });

  it('sends a cancellation message for the same appointment', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    const service = new MailService(config());

    await service.sendBookingCancellation({
      ...message,
      reference: 'Código VF-ABC12345.',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      subject: string;
      htmlContent: string;
    };
    expect(body.subject).toBe('Tu reserva en VenueFlow fue cancelada');
    expect(body.htmlContent).toContain('Reserva cancelada');
    expect(body.htmlContent).toContain('VF-ABC12345');
  });

  it('refuses to send when Brevo is not configured', async () => {
    const service = new MailService(new ConfigService({}));
    await expect(service.sendBookingVerification(message)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

function config() {
  return new ConfigService({
    BREVO_API_KEY: 'xkeysib-test',
    BREVO_SENDER_EMAIL: 'reservas@venueflow.test',
    BREVO_SENDER_NAME: 'VenueFlow',
  });
}
