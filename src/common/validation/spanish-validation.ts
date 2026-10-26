import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

const labels: Record<string, string> = {
  additionalPrice: 'El adicional',
  closingMinute: 'La hora de cierre',
  commissionRate: 'La comisión',
  currentPassword: 'La contraseña actual',
  customerEmail: 'El correo',
  customerName: 'El nombre',
  customerNationalId: 'La cédula',
  customerPhone: 'El teléfono',
  date: 'La fecha',
  dayOfWeek: 'El día',
  displayName: 'El nombre visible',
  durationMinutes: 'La duración',
  email: 'El correo',
  endTime: 'La hora de cierre',
  firstName: 'El nombre',
  lastName: 'El apellido',
  name: 'El nombre',
  nationalId: 'La cédula',
  newPassword: 'La nueva contraseña',
  notes: 'Las notas',
  openingMinute: 'La hora de apertura',
  password: 'La contraseña',
  phone: 'El teléfono',
  price: 'El precio',
  professionalId: 'La profesional',
  serviceId: 'El servicio',
  startAt: 'El horario',
  startTime: 'La hora de inicio',
  status: 'El estado',
  walkInGraceMinutes: 'La tolerancia',
};

function label(property: string) {
  return labels[property] ?? 'Este dato';
}

function phrase(constraint: string, field: string) {
  switch (constraint) {
    case 'isNotEmpty':
      return `${field} es obligatorio.`;
    case 'minLength':
      return `${field} es demasiado corto.`;
    case 'maxLength':
      return `${field} es demasiado largo.`;
    case 'isEmail':
      return `${field} no es un correo válido.`;
    case 'matches':
      return `${field} no tiene el formato correcto.`;
    case 'isISO8601':
    case 'isDateString':
      return `${field} no es una fecha válida.`;
    case 'min':
      return `${field} está por debajo del mínimo.`;
    case 'max':
      return `${field} supera el máximo permitido.`;
    case 'isDivisibleBy':
      return `${field} debe usar intervalos de 30 minutos.`;
    case 'isIn':
      return `${field} no es una opción válida.`;
    case 'isInt':
    case 'isNumber':
      return `${field} debe ser un número.`;
    case 'isDecimal':
      return `${field} no es un monto válido.`;
    case 'whitelistValidation':
      return 'Hay un dato que no corresponde a este formulario.';
    default:
      return `${field} no es válido.`;
  }
}

export function spanishValidationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => {
    const own = Object.keys(error.constraints ?? {}).map((key) =>
      phrase(key, label(error.property)),
    );
    const nested = error.children?.length
      ? spanishValidationMessages(error.children)
      : [];
    return [...own, ...nested];
  });
}

export function spanishValidationException(errors: ValidationError[]) {
  const messages = spanishValidationMessages(errors);
  return new BadRequestException(
    messages.length ? messages : ['Revisa los datos enviados.'],
  );
}
