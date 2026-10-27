
import { OPTION_CARD, OPTION_INPUT } from "@/components/FormField";
import { Section } from "./SignupFields";

export function ConsentSection({
  checked,
  onChange,
  pledged,
  onPledge,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  pledged: boolean;
  onPledge: (v: boolean) => void;
}) {
  return (
    <Section title="الموافقة" required>
      <div className="rounded border border-foreground/15 bg-foreground/5 p-4 text-base leading-relaxed">
        <p>
          المعلومات التي أدخلتها (الاسم، رقم الهاتف، رقم الترخيص،
          التخصصات، وأماكن العمل) ستُستخدم داخل المنصة لمساعدة زملائك من
          الأطباء المسجلين على إيجادك والتواصل معك مهنيًا، ولأي استخدامات
          تخدم تطوير المنصة أو توسيع شبكة التواصل.
        </p>
      </div>

      <label className={OPTION_CARD}>
        <input
          id="consent"
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={OPTION_INPUT}
        />
        <span>
          أوافق على ما ورد أعلاه، وأؤكد أنني طبيب وأن المعلومات المدخلة
          صحيحة، وأوافق على استخدامها.
        </span>
      </label>

      {/* Its own box, so it reads as a commitment of its own (#192). */}
      <label className={OPTION_CARD}>
        <input
          id="pledge"
          type="checkbox"
          required
          checked={pledged}
          onChange={(e) => onPledge(e.target.checked)}
          className={OPTION_INPUT}
        />
        <span>
          ألتزم باستخدام أرقام الزملاء للتواصل المهني فقط، وبعدم مشاركتها مع
          المرضى أو مع أي شخص من خارج الطاقم الطبي.
        </span>
      </label>
    </Section>
  );
}
