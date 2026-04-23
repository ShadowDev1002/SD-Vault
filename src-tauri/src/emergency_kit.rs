use printpdf::*;
use std::io::BufWriter;

/// Generiert ein Emergency Kit PDF und gibt die rohen PDF-Bytes zurück.
pub fn generate_pdf(
    vault_id: &str,
    secret_key_formatted: &str,
    created_at: &str,
) -> Result<Vec<u8>, String> {
    let (doc, page1, layer1) =
        PdfDocument::new("SD-Vault Emergency Kit", Mm(210.0), Mm(297.0), "Layer 1");
    let layer = doc.get_page(page1).get_layer(layer1);

    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;
    let font_mono = doc
        .add_builtin_font(BuiltinFont::Courier)
        .map_err(|e| e.to_string())?;

    layer.use_text("SD-Vault Emergency Kit", 24.0, Mm(20.0), Mm(265.0), &font_bold);

    // Trennlinie
    let line = Line {
        points: vec![
            (Point::new(Mm(20.0), Mm(258.0)), false),
            (Point::new(Mm(190.0), Mm(258.0)), false),
        ],
        is_closed: false,
    };
    layer.set_outline_color(Color::Rgb(Rgb::new(0.4, 0.4, 0.4, None)));
    layer.set_outline_thickness(0.5);
    layer.add_line(line);

    layer.use_text(
        "WICHTIG: Ohne diesen Secret Key und Ihr Master-Passwort",
        11.0, Mm(20.0), Mm(248.0), &font_bold,
    );
    layer.use_text(
        "kann Ihr Vault NICHT geoeffnet werden. Sicher aufbewahren.",
        11.0, Mm(20.0), Mm(241.0), &font_bold,
    );

    layer.use_text("Vault-ID:", 10.0, Mm(20.0), Mm(224.0), &font_bold);
    layer.use_text(vault_id, 10.0, Mm(55.0), Mm(224.0), &font_mono);

    layer.use_text("Secret Key:", 10.0, Mm(20.0), Mm(210.0), &font_bold);
    layer.use_text(secret_key_formatted, 14.0, Mm(20.0), Mm(200.0), &font_mono);

    layer.use_text("Erstellt am:", 10.0, Mm(20.0), Mm(184.0), &font_bold);
    layer.use_text(created_at, 10.0, Mm(55.0), Mm(184.0), &font);

    layer.use_text("So entsperren Sie Ihren Vault:", 11.0, Mm(20.0), Mm(168.0), &font_bold);
    let steps = [
        "1. SD-Vault starten und 'Vault oeffnen' waehlen.",
        "2. Ihr Master-Passwort eingeben.",
        "3. Den Secret Key aus diesem Dokument eingeben.",
        "4. Ihr Vault wird entschluesselt und geoeffnet.",
    ];
    for (i, text) in steps.iter().enumerate() {
        layer.use_text(*text, 10.0, Mm(20.0), Mm(160.0 - (i as f32 * 8.0)), &font);
    }

    layer.use_text(
        "SD-Vault — Zero-Knowledge Passwort-Manager",
        9.0, Mm(20.0), Mm(15.0), &font,
    );

    let mut buffer = Vec::new();
    doc.save(&mut BufWriter::new(&mut buffer))
        .map_err(|e| e.to_string())?;

    Ok(buffer)
}
