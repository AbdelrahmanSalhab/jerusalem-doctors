
import { OPTION_CARD, OPTION_INPUT } from "@/components/FormField";
import { Section } from "./SignupFields";

export function ConsentSection({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
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
    </Section>
  );
}
