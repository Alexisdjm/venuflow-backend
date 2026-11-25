import {
  ArrayUnique,
  IsArray,
  IsDecimal,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PACKAGE_SESSION_MAX,
  PACKAGE_SESSION_MIN,
} from '../package-session-count';

export class PackagePlanDto {
  @IsUUID() serviceId!: string;
  @IsInt() @Min(PACKAGE_SESSION_MIN) @Max(PACKAGE_SESSION_MAX) sessionCount!: number;
  @IsInt() @Min(1) @Max(5) sessionsPerWeek!: number;
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  preferredWeekdays!: number[];
  @IsUUID() professionalId!: string;
  @IsISO8601({ strict: true }) startAt!: string;
  @IsOptional() @IsIn([2, 3]) maxReschedules?: 2 | 3;
  @IsIn(['PAGO_MOVIL', 'PUNTO_DE_VENTA', 'ZELLE', 'BINANCE'])
  paymentMethod!: 'PAGO_MOVIL' | 'PUNTO_DE_VENTA' | 'ZELLE' | 'BINANCE';
  @ValidateIf((dto: PackagePlanDto) => dto.durationMinutes !== undefined)
  @IsInt()
  @Min(30)
  @Max(720)
  @IsDivisibleBy(30)
  durationMinutes?: number;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) customerName?: string;
  @IsOptional() @Matches(/^\d{7,8}$/) customerNationalId?: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(40) customerPhone?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsISO8601({ strict: true }, { each: true })
  sessionStarts?: string[];
}

export class AssignPackageDto {
  @IsUUID() serviceId!: string;
  @IsInt() @Min(PACKAGE_SESSION_MIN) @Max(PACKAGE_SESSION_MAX) sessionCount!: number;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) paidAmount?: string;
}

export class PackagePaymentDto {
  @IsDecimal({ decimal_digits: '0,2' }) amount!: string;
}
