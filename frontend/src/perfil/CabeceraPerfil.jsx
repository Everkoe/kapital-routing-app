import { BadgeCheck, Camera, Loader2, Mail, IdCard } from 'lucide-react';
import ImagenGuardada from '../components/ImagenGuardada';
import { cuentaDe, estadoDe, iniciales } from './modeloPerfil';
import { useFotoConPrevia } from './useFotoConPrevia';

/**
 * La cabecera de «Mi perfil»: quién eres, de un vistazo.
 *
 * Foto, nombre, rol, la cuenta con la que entras y el estado de la cuenta.
 * La foto se cambia pulsándola o soltando una imagen encima, y se guarda sola,
 * como todo en la aplicación: antes había que acordarse de «Guardar cambios».
 * Mientras sube se enseña la del propio equipo, para no esperar una ida y
 * vuelta al servidor.
 */
const CabeceraPerfil = ({ usuario, onCambiarFoto, limiteMb }) => {
  const {
    previa, subiendo, getRootProps, getInputProps, isDragActive,
  } = useFotoConPrevia(onCambiarFoto);
  const cuenta = cuentaDe(usuario);
  const estado = estadoDe(usuario);
  const IconoCuenta = cuenta.etiqueta === 'Correo' ? Mail : IdCard;

  let foto = null;
  if (previa) foto = <img src={previa} alt="" className="pf-avatar-img" />;
  else if (usuario.avatar) foto = <ImagenGuardada imagen={usuario.avatar} alt="" className="pf-avatar-img" />;

  return (
    <section className="pf-cabecera">
      <div className="pf-portada" aria-hidden="true" />
      <div className="pf-identidad">
        <div {...getRootProps({
          className: 'pf-avatar',
          role: 'button',
          'aria-label': 'Cambiar foto de perfil',
          title: `Cambiar foto · JPG, PNG o WebP, hasta ${limiteMb} MB`,
          'data-arrastrando': isDragActive || undefined,
        })}>
          <input {...getInputProps()} />
          <span className="pf-avatar-iniciales" aria-hidden="true">{iniciales(usuario.nombre)}</span>
          {foto}
          <span className="pf-avatar-camara" aria-hidden="true">
            {subiendo ? <Loader2 size={16} className="pf-girando" /> : <Camera size={16} />}
          </span>
        </div>

        <div className="pf-identidad-texto">
          <h1 className="pf-nombre">{usuario.nombre || 'Sin nombre'}</h1>
          <div className="pf-identidad-meta">
            <span className="pf-rol"><BadgeCheck size={14} aria-hidden="true" />{usuario.rol}</span>
            <span className="pf-meta">
              <IconoCuenta size={14} aria-hidden="true" />
              <span className="pf-meta-texto">{cuenta.valor}</span>
            </span>
            <span className="pf-estado" data-tono={estado.tono}>{estado.texto}</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CabeceraPerfil;
